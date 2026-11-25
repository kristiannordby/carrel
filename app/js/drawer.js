/* The right-hand drawer (slides, Claude, tasks), the highlight toolbar and the "Explain concept" sheet. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;

  // ================================================================ drawer frame
  const drawer = { pane: null };
  C.drawer = drawer;
  drawer.open = function (pane) {
    const el = $('#drawer');
    if (el.hidden) drawer.opener = document.activeElement;
    el.hidden = false;
    $('#shell').classList.add('has-drawer');
    drawer.show(pane || drawer.pane || 'slides');
  };
  drawer.close = function () {
    const back = drawer.opener;
    drawer.opener = null;
    $('#drawer').hidden = true;
    if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    $('#shell').classList.remove('has-drawer');
    drawer.pane = null;
    C.store.set('drawer', { open: false });
  };
  drawer.isOpen = () => !$('#drawer').hidden;
  drawer.show = function (pane) {
    drawer.pane = pane;
    $$('#drawer [role="tab"]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.pane === pane)); b.tabIndex = b.dataset.pane === pane ? 0 : -1; });
    $$('#drawer .pane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === pane));
    if (pane === 'slides') slides.render();
    if (pane === 'chat') chat.render();
    if (pane === 'tasks' && C.tasks) C.tasks.mount($('#paneTasks'), { compact: true });
    if (pane === 'notes' && C.notes) C.notes.mount($('#paneNotes'));
    C.store.set('drawer', { open: true, pane });
  };
  function initFrame() {
    $$('#drawer [role="tab"]').forEach((b) => (b.onclick = () => drawer.show(b.dataset.pane)));
    $('#drawer [role="tablist"]').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (document.fullscreenElement) return;
      const tabs = $$('#drawer [role="tab"]');
      const i = tabs.indexOf(document.activeElement);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      drawer.show(n.dataset.pane);
      n.focus();
      e.preventDefault();
      e.stopPropagation();
    });
    $('#closeDrawer').onclick = drawer.close;
    $('#openChat').onclick = () => (drawer.isOpen() && drawer.pane === 'chat' ? drawer.close() : (drawer.open('chat'), chat.focus()));
    const w = C.settings().drawerW;
    if (w) document.documentElement.style.setProperty('--drawer-w', w + 'px');
    const grip = $('#drawerGrip');
    let startX, startW;
    const move = (e) => {
      const nw = Math.max(340, Math.min(window.innerWidth * 0.62, startW + (startX - e.clientX)));
      document.documentElement.style.setProperty('--drawer-w', Math.round(nw) + 'px');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const nw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--drawer-w'), 10);
      C.store.update('settings', {}, (s) => { s.drawerW = nw; });
      if (drawer.pane === 'slides') slides.render();
    };
    grip.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startW = $('#drawer').getBoundingClientRect().width;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    });
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cur = $('#drawer').getBoundingClientRect().width;
      document.documentElement.style.setProperty('--drawer-w', Math.round(cur + (e.key === 'ArrowLeft' ? 32 : -32)) + 'px');
      up();
      e.preventDefault();
    });
  }

  // ================================================================ slides
  const slides = { fi: null, p: 1, showText: false, docs: {}, zoom: 1 };
  C.slides = slides;
  const PDFJS_WORKER = 'vendor/pdfjs/pdf.worker.min.js';

  slides.open = function (fi, p, opts) {
    if (fi == null) return;
    slides.fi = fi;
    slides.p = Math.max(1, p || 1);
    slides.from = opts && opts.from;
    drawer.open('slides');
    setTimeout(() => { const t = $('#paneTabSlides'); t && t.focus({ preventScroll: true }); }, 0);
    C.store.set('slides', { fi: slides.fi, p: slides.p });
  };
  slides.fileUrl = function (f, page) {
    const vp = C.data.vault().vaultPath;
    if (C.server.ok) return '/vault/' + f.k.split('/').map(encodeURIComponent).join('/') + (page ? '#page=' + page : '');
    if (vp && location.protocol === 'file:') return 'file:///' + vp.replace(/\\/g, '/').split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/') + '/' + f.k.split('/').map(encodeURIComponent).join('/') + (page ? '#page=' + page : '');
    return null;
  };
  function getDoc(f) {
    if (!window.pdfjsLib || !C.server.ok) return Promise.reject(new Error('viewer'));
    if (!slides.docs[f.k]) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      slides.docs[f.k] = window.pdfjsLib.getDocument({ url: slides.fileUrl(f) }).promise;
      slides.docs[f.k].catch(() => delete slides.docs[f.k]);
    }
    return slides.docs[f.k];
  }
  async function paint(canvas, f, page, width) {
    const doc = await getDoc(f);
    const pg = await doc.getPage(page);
    const vp1 = pg.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (width / vp1.width) * dpr;
    const vp = pg.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.aspectRatio = vp.width + ' / ' + vp.height;
    canvas.style.width = Math.round(width) + 'px';
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return { pg, cssScale: width / vp1.width };
  }
  // pdf.js lays transparent, selectable text exactly over the drawn page
  async function textLayer(host, painted) {
    if (!window.pdfjsLib || !window.pdfjsLib.renderTextLayer) return;
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.style.setProperty('--scale-factor', painted.cssScale);
    host.appendChild(layer);
    try {
      const content = await painted.pg.getTextContent();
      await window.pdfjsLib.renderTextLayer({ textContentSource: content, container: layer, viewport: painted.pg.getViewport({ scale: painted.cssScale }), textDivs: [] }).promise;
    } catch (e) { layer.remove(); }
  }
  // one page as a node (canvas plus selectable text), for views outside the side panel
  slides.pageNode = async function (fi, p, width) {
    const f = C.data.files()[fi];
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', f.f + ', page ' + p);
    const done = await paint(cv, f, p, width);
    const page = document.createElement('div');
    page.className = 'slidepage';
    page.style.width = Math.round(width) + 'px';
    page.dataset.ctx = JSON.stringify({ course: f.c, kind: 'slide', slide: [fi, p], label: C.fileShort(f) + ' p.' + p });
    page.appendChild(cv);
    textLayer(page, done);
    return page;
  };
  // the side panel shows the whole deck as one scrolling column; pages are drawn as they near the view and dropped
  // when far away, and the page box follows the page you are looking at
  slides.render = async function () {
    const el = $('#paneSlides');
    const files = C.data.files();
    if (slides.fi == null) {
      const last = C.store.get('slides');
      if (last && files[last.fi]) { slides.fi = last.fi; slides.p = last.p; }
    }
    if (slides.fi == null || !files[slides.fi]) {
      el.innerHTML = '<div class="page"><div class="state"><h3>No slide open</h3><p>Click a question number, a card number or a slide link and the lecture opens here at the page that covers it.</p></div></div>';
      return;
    }
    const f = files[slides.fi];
    slides.p = Math.min(Math.max(1, slides.p), f.n);
    // the same deck at the same size is already laid out: just move to the page
    const stage0 = $('#slideStage');
    const full0 = !!document.fullscreenElement && document.fullscreenElement === (stage0 && stage0.closest('.slides'));
    if (stage0 && slides._key === layoutKey(f, stage0, full0)) {
      if (slides.from !== undefined) $('.slides__sub', el).textContent = subLine(f);
      scrollToPage(slides.p, false);
      return;
    }
    const sameCourse = files.map((x, i) => [x, i]).filter(([x]) => x.c === f.c);
    const token = (slides._tok = (slides._tok || 0) + 1);
    if (slides._io) { slides._io.disconnect(); slides._io = null; }
    el.innerHTML =
      '<div class="slides">' +
      '<div class="slides__head">' +
      '<div class="slides__deck"><label class="visually-hidden" for="deckSel">Lecture deck</label><select id="deckSel">' +
      sameCourse.map(([x, i]) => '<option value="' + i + '"' + (i === slides.fi ? ' selected' : '') + '>' + esc(x.f.replace(/\.pdf$/i, '')) + '</option>').join('') +
      '</select>' + (slides.fileUrl(f) ? '<a class="iconbtn" id="slOpen" href="' + esc(slides.fileUrl(f, slides.p)) + '" target="_blank" rel="noopener" aria-label="Open the PDF in a new tab" title="Open PDF">' + C.icon.ext + '</a>' : '') + '</div>' +
      '<div class="slides__sub">' + esc(subLine(f)) + '</div>' +
      '</div>' +
      '<div class="slides__stage" id="slideStage" tabindex="0" aria-label="' + esc(f.f.replace(/\.pdf$/i, '')) + ', ' + f.n + ' pages; scroll to move through them"><div class="slideskel" role="img" aria-label="Loading slides" style="aspect-ratio:' + (f.ar || 1.333) + '"></div></div>' +
      '<div class="slides__foot">' +
      '<div class="pg"><button class="iconbtn" type="button" id="slPrev" aria-label="Previous page">' + C.icon.left + '</button>' +
      '<label class="visually-hidden" for="slPage">Page</label><input id="slPage" type="number" inputmode="numeric" min="1" max="' + f.n + '" value="' + slides.p + '"> <span>of ' + f.n + '</span>' +
      '<button class="iconbtn" type="button" id="slNext" aria-label="Next page">' + C.icon.right + '</button></div>' +
      '<div class="qactions"><span class="zoom" role="group" aria-label="Zoom"><button class="iconbtn" type="button" id="slOut" aria-label="Zoom out"' + (slides.zoom <= 1 ? ' disabled' : '') + '>−</button><button class="iconbtn" type="button" id="slIn" aria-label="Zoom in"' + (slides.zoom >= 3 ? ' disabled' : '') + '>+</button></span>' +
      '<button class="iconbtn" type="button" id="slFull" aria-label="Full screen" title="Full screen (F)"><svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4"/></svg></button>' +
      '<button class="btn btn--sm" type="button" id="slText" aria-pressed="' + slides.showText + '">Text</button>' +
      '<button class="btn btn--sm" type="button" id="slAsk">Ask about this slide</button>' +
      '</div></div></div>';
    const relayout = () => { slides._key = null; slides.render(); };
    $('#deckSel').onchange = (e) => { slides.fi = +e.target.value; slides.p = 1; relayout(); };
    $('#slPrev').onclick = () => slides.go(-1);
    $('#slNext').onclick = () => slides.go(1);
    $('#slPage').onchange = (e) => { slides.p = Math.min(f.n, Math.max(1, +e.target.value || 1)); scrollToPage(slides.p, true); };
    $('#slText').onclick = () => { slides.showText = !slides.showText; relayout(); };
    $('#slIn').onclick = () => { slides.zoom = Math.min(3, slides.zoom + 0.5); relayout(); };
    $('#slOut').onclick = () => { slides.zoom = Math.max(1, slides.zoom - 0.5); relayout(); };
    $('#slFull').onclick = () => slides.fullscreen();
    $('#slAsk').onclick = () => chat.open({ ctx: { course: f.c, kind: 'slide', slide: [slides.fi, slides.p] }, label: f.f.replace(/\.pdf$/i, '') + ', page ' + slides.p, prompt: 'Walk me through this slide: what it says, why it matters, and how it connects to the rest of the lecture.' });
    const stage = $('#slideStage');
    const full = document.fullscreenElement === stage.closest('.slides');
    const width = pageWidth(f, stage, full);
    let ok = false;
    if (C.server.ok && window.pdfjsLib) {
      try { await getDoc(f); ok = true; } catch (e) { /* fall through to the iframe */ }
      if (token !== slides._tok) return;
    }
    if (!ok && !C.server.checked) return; // keep the skeleton; the boot sequence re-renders once the server answers
    if (!ok) {
      const url = slides.fileUrl(f, slides.p);
      stage.innerHTML = url ? '<iframe title="' + esc(f.f) + '" src="' + esc(url) + '"></iframe>' : '<div class="state"><h3>The slide viewer needs the local server</h3><p>Start Carrel with "Start Carrel.cmd" to render slides here. The slide text is below.</p></div>';
      if (!url) { slides.showText = true; const text = await C.loadSlideText(); const d = document.createElement('div'); d.className = 'slides__text'; d.textContent = (text[slides.fi] || [])[slides.p - 1] || 'No text on this page (it may be an image).'; stage.appendChild(d); }
      slides._key = null;
      setPage(slides.p, f);
      return;
    }
    const text = slides.showText ? await C.loadSlideText() : null;
    if (token !== slides._tok) return;
    // one placeholder per page, sized to the deck's shape so the scroll position is right before anything is drawn
    stage.innerHTML = '';
    for (let p = 1; p <= f.n; p++) {
      const page = document.createElement('div');
      page.className = 'slidepage is-blank';
      page.dataset.p = p;
      page.style.width = Math.round(width) + 'px';
      page.style.aspectRatio = String(f.ar || 1.333);
      page.dataset.ctx = JSON.stringify({ course: f.c, kind: 'slide', slide: [slides.fi, p], label: C.fileShort(f) + ' p.' + p });
      stage.appendChild(page);
      if (text) {
        const d = document.createElement('div');
        d.className = 'slides__text';
        d.style.width = Math.round(width) + 'px';
        d.dataset.ctx = JSON.stringify({ course: f.c, kind: 'slide', slide: [slides.fi, p] });
        d.textContent = (text[slides.fi] || [])[p - 1] || 'No text on page ' + p + ' (it may be an image).';
        stage.appendChild(d);
      }
    }
    slides._key = layoutKey(f, stage, full);
    slides._io = new IntersectionObserver((entries) => entries.forEach((en) => {
      const page = en.target, p = +page.dataset.p;
      if (en.isIntersecting && page.classList.contains('is-blank')) {
        page.classList.remove('is-blank');
        const cv = document.createElement('canvas');
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', f.f + ', page ' + p);
        paint(cv, f, p, width).then((done) => {
          if (token !== slides._tok || page.classList.contains('is-blank')) return;
          page.replaceChildren(cv);
          page.style.aspectRatio = '';
          textLayer(page, done);
        }).catch(() => page.classList.add('is-blank'));
      } else if (!en.isIntersecting && !page.classList.contains('is-blank')) {
        // far out of view: give the memory back, keep the size so nothing jumps
        page.style.aspectRatio = page.offsetWidth + ' / ' + page.offsetHeight;
        page.replaceChildren();
        page.classList.add('is-blank');
      }
    }), { root: stage, rootMargin: '150% 0px' });
    $$('.slidepage', stage).forEach((x) => slides._io.observe(x));
    let ticking = false;
    stage.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      // a hidden panel (closed drawer) measures every page at 0; never read a page from that
      requestAnimationFrame(() => { ticking = false; if (slides._jumping || !stage.isConnected || !stage.clientHeight) return; const p = pageAtTop(stage); if (p && p !== slides.p) setPage(p, f); });
    }, { passive: true });
    scrollToPage(slides.p, false);
  };
  function subLine(f) {
    const course = C.data.course(f.c);
    return (course ? course.code + ' ' + course.short : '') + (slides.from ? ', linked from ' + slides.from : '');
  }
  function pageWidth(f, stage, full) {
    return full ? Math.min(window.innerWidth - 48, (window.innerHeight - 140) * (f.ar || 1.333)) * slides.zoom : (stage.clientWidth - 32) * slides.zoom;
  }
  function layoutKey(f, stage, full) {
    return [slides.fi, slides.zoom, slides.showText, full, Math.round(pageWidth(f, stage, full))].join('|');
  }
  // the page whose area covers a point a third of the way down the view
  function pageAtTop(stage) {
    const line = stage.getBoundingClientRect().top + stage.clientHeight / 3;
    let best = null;
    for (const x of $$('.slidepage', stage)) {
      const r = x.getBoundingClientRect();
      if (r.top <= line) best = +x.dataset.p; else break;
    }
    return best || 1;
  }
  function setPage(p, f) {
    slides.p = p;
    const inp = $('#slPage'); if (inp && document.activeElement !== inp) inp.value = p;
    const prev = $('#slPrev'), next = $('#slNext');
    if (prev) prev.disabled = p <= 1;
    if (next) next.disabled = p >= f.n;
    const open = $('#slOpen'); if (open) open.href = slides.fileUrl(f, p);
    C.store.set('slides', { fi: slides.fi, p });
  }
  function scrollToPage(p, smooth) {
    const stage = $('#slideStage');
    const f = C.data.files()[slides.fi];
    if (!stage || !f) return;
    setPage(p, f);
    const page = $('.slidepage[data-p="' + p + '"]', stage);
    if (!page) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slides._jumping = true;
    stage.scrollTo({ top: stage.scrollTop + page.getBoundingClientRect().top - stage.getBoundingClientRect().top - 8, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    clearTimeout(slides._jt);
    slides._jt = setTimeout(() => (slides._jumping = false), smooth && !reduce ? 600 : 50);
  }
  slides.fullscreen = function () {
    const box = $('#paneSlides .slides');
    if (!box) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (box.requestFullscreen) box.requestFullscreen().catch(() => C.toast('Full screen is blocked in this window.'));
  };
  document.addEventListener('fullscreenchange', () => { if (C.drawer.pane === 'slides') slides.render(); });
  document.addEventListener('keydown', (e) => {
    if (!document.fullscreenElement || !document.fullscreenElement.classList.contains('slides')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { slides.go(1); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { slides.go(-1); e.preventDefault(); }
  });
  slides.go = function (d) {
    const f = C.data.files()[slides.fi];
    if (!f) return;
    const p = Math.min(f.n, Math.max(1, slides.p + d));
    if ($('#slideStage .slidepage')) scrollToPage(p, true);
    else { slides.p = p; slides.render(); }
  };
  // find the slide that best covers a phrase, preferring the current lecture's decks
  slides.find = async function (phrase, course, preferFiles) {
    const text = await C.loadSlideText();
    const files = C.data.files();
    const words = phrase.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    if (!words.length) return null;
    let best = null;
    files.forEach((f, fi) => {
      if (course && f.c !== course) return;
      (text[fi] || []).forEach((pg, i) => {
        const low = pg.toLowerCase();
        let s = low.includes(phrase.toLowerCase()) ? 6 : 0;
        words.forEach((w) => { if (low.includes(w)) s += 1; });
        if (preferFiles && preferFiles.includes(fi)) s *= 1.4;
        if (i === 0) s *= 0.6;
        if (!best || s > best.s) best = { fi, p: i + 1, s };
      });
    });
    return best && best.s > 0 ? best : null;
  };

  // ================================================================ chat
  const chat = { thread: null, busy: null };
  C.chat = chat;
  function loadThread() {
    if (!chat.thread) chat.thread = C.store.get('chat', null) || { ctx: null, label: '', messages: [] };
    return chat.thread;
  }
  function saveThread() { C.store.set('chat', C.stamp(chat.thread)); }
  chat.newThread = function (ctx, label) {
    if (chat.busy) chat.busy.abort();
    if (chat.thread && chat.thread.messages.length) {
      const snap = JSON.parse(JSON.stringify(chat.thread));
      snap.messages.forEach((m) => { if (m.streaming) { m.streaming = false; m.content = m.content || '_Stopped._'; } });
      C.store.update('chats', [], (h) => { h.unshift(snap); return h.slice(0, 30); });
    }
    chat.thread = { id: C.uid(), at: Date.now(), ctx: ctx || null, label: label || '', messages: [] };
    saveThread();
  };
  // open the chat with a context; optional seed (an explanation already shown) and an optional prompt to send now
  chat.open = function ({ ctx, label, prompt, seed, send }) {
    chat.newThread(ctx, label);
    if (seed) chat.thread.messages.push({ role: 'user', content: seed.user, shown: seed.shown }, { role: 'assistant', content: seed.assistant });
    saveThread();
    drawer.open('chat');
    if (prompt && send !== false) chat.send(prompt);
    else chat.focus();
  };
  chat.focus = () => setTimeout(() => { const t = $('#chatInput'); t && t.focus(); }, 30);
  chat.render = function () {
    const th = loadThread();
    const el = $('#paneChat');
    const backend = C.claude.available();
    el.innerHTML =
      '<div class="chat">' +
      '<div class="chat__ctx">' + (th.label ? '<span class="ctxpill" title="Claude sees this context">' + C.icon.slide + '<span>' + esc(th.label) + '</span></span>' : '<span>No study context yet. Ask anything, or highlight text in a lecture set.</span>') +
      '<span class="push"></span><button class="btn btn--sm btn--quiet" type="button" id="chatHist" aria-pressed="' + !!chat.showHist + '">History</button><button class="btn btn--sm btn--quiet" type="button" id="chatNew">New chat</button></div>' +
      '<div class="chat__log" id="chatLog" aria-busy="' + !!chat.busy + '"></div>' +
      '<form class="chat__form" id="chatForm">' +
      '<label class="visually-hidden" for="chatInput">Message Claude</label>' +
      '<textarea id="chatInput" name="message" placeholder="' + (backend ? 'Ask about this concept, or say what confused you' : 'Claude is not connected yet') + '" rows="3"></textarea>' +
      '<div class="chat__row"><span class="muted">' + esc(C.claude.describe()) + '.<span class="onkeys"> Enter sends, Shift+Enter for a new line.</span></span>' +
      '<button class="btn btn--primary" type="submit" id="chatSend">' + (chat.busy ? 'Stop' : 'Send') + '</button></div>' +
      '</form></div>';
    $('#chatNew').onclick = () => { chat.showHist = false; chat.newThread(); chat.render(); chat.focus(); };
    $('#chatHist').onclick = () => { chat.showHist = !chat.showHist; chat.render(); };
    $('#chatForm').onsubmit = (e) => {
      e.preventDefault();
      if (chat.busy) { chat.busy.abort(); return; }
      const v = $('#chatInput').value.trim();
      if (v) chat.send(v);
    };
    // on a touchscreen Return is a new line and Send sends, as in Messages
    $('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
    drawLog();
  };
  function drawHistory(log) {
    const hist = C.store.get('chats', []);
    if (!hist.length) { log.innerHTML = '<div class="state"><h3>No earlier chats</h3><p>Conversations land here when you start a new one. The last 30 are kept.</p></div>'; return; }
    log.innerHTML = '<div class="results">' + hist.map((h, i) => {
      const first = (h.messages.find((m) => m.role === 'user') || {});
      const turns = h.messages.filter((m) => m.role === 'user').length;
      return '<button class="result" type="button" data-h="' + i + '"><span class="result__t">' + esc(h.label || (first.shown || first.content || '').slice(0, 90)) + '</span><span class="result__m"><span>' + (h.at ? esc(C.fmtShort(C.iso(new Date(h.at)))) : '') + '</span><span>' + turns + (turns === 1 ? ' question' : ' questions') + '</span></span></button>';
    }).join('') + '</div>';
    $$('[data-h]', log).forEach((b) => (b.onclick = () => {
      const i = +b.dataset.h;
      if (chat.busy) chat.busy.abort();
      const snap = chat.thread && chat.thread.messages.length ? JSON.parse(JSON.stringify(chat.thread)) : null;
      if (snap) snap.messages.forEach((m) => { if (m.streaming) { m.streaming = false; m.content = m.content || '_Stopped._'; } });
      C.store.update('chats', [], (list) => {
        const picked = list.splice(i, 1)[0];
        if (snap) list.unshift(snap);
        chat.thread = picked;
        return list.slice(0, 30);
      });
      saveThread();
      chat.showHist = false;
      chat.render();
    }));
  }
  // what goes to the clipboard: Obsidian-ready, with the question and a source line
  function asMarkdown(i) {
    const th = loadThread();
    const m = th.messages[i];
    const q = th.messages.slice(0, i).reverse().find((x) => x.role === 'user');
    const body = (m.content || '').replace(/\n?\s*\**Go deeper:?\**:?\s*(.+)\s*$/i, '').trim();
    return '## ' + (th.label || (q && (q.shown || '').slice(0, 80)) || 'Claude') + '\n\n' + (q && q.shown ? '> ' + q.shown.replace(/\n/g, '\n> ') + '\n\n' : '') + body + '\n\n_Claude via Carrel, ' + C.today() + '_\n';
  }
  function drawLog() {
    const th = loadThread();
    const log = $('#chatLog');
    if (!log) return;
    if (chat.showHist) return drawHistory(log);
    if (!th.messages.length) {
      const sug = th.ctx ? ['Explain this from first principles', 'Give me a harder variant to try', 'What would an exam ask about this?'] : ['Quiz me on my weakest lecture', 'What is due this week?', 'Make a study plan for my midterms'];
      log.innerHTML = '<div class="state"><h3>' + (th.ctx ? 'Ask about ' + esc(th.label || 'this') : 'Claude') + '</h3><p>' +
        (C.claude.available() ? 'Claude gets the question, its lecture slide text and your answer, so you can skip the setup.' : 'Start Carrel with "Start Carrel.cmd" to use Claude Code on this machine, or add an Anthropic API key in Settings.') +
        '</p><div class="suggest">' + sug.map((s) => '<button class="chip" type="button">' + esc(s) + '</button>').join('') + '</div></div>';
      $$('.suggest .chip', log).forEach((b) => (b.onclick = () => chat.send(b.textContent)));
      return;
    }
    log.innerHTML = th.messages.map((m, i) => {
      if (m.role === 'user') return '<div class="msg msg--user"><div class="msg__who">You</div><div class="msg__body">' + esc(m.shown != null ? m.shown : m.content) + '</div></div>';
      const gm = !m.streaming && (m.content || '').match(/\n?\s*\**Go deeper:?\**:?\s*(.+)\s*$/i);
      const body = gm ? m.content.slice(0, gm.index) : m.content || '';
      const qs = gm ? gm[1].split('|').map((s) => s.trim()).filter(Boolean) : [];
      return '<div class="msg"><div class="msg__who">Claude' + (m.streaming ? '' : '<button class="iconbtn msg__copy" type="button" data-copy="' + i + '" aria-label="Copy this answer as Markdown" title="Copy as Markdown">' + C.icon.copy + '</button>') + '</div><div class="msg__body prose' + (m.streaming && body ? ' caret' : '') + '">' + (m.streaming && !body ? '<div class="skel" aria-label="Claude is writing"><i></i><i></i><i></i></div>' : C.md(body)) + '</div>' +
        (qs.length && i === th.messages.length - 1 ? '<div class="suggest">' + qs.map((q) => '<button class="chip" type="button" data-q>' + esc(q) + '</button>').join('') + '</div>' : '') +
        (m.error ? '<div class="msg__err"><span>' + esc(C.friendlyError(m.error)) + '</span>' + (i === th.messages.length - 1 ? '<button class="btn btn--sm" type="button" data-retry>Retry</button>' : '') + '</div>' : '') + '</div>';
    }).join('');
    C.renderMath(log);
    $$('[data-q]', log).forEach((b) => (b.onclick = () => chat.send(b.textContent)));
    $$('[data-retry]', log).forEach((b) => (b.onclick = () => {
      // drop the failed pair and ask again
      const last = th.messages.pop();
      const q = th.messages.pop();
      if (!q || q.role !== 'user') { if (q) th.messages.push(q); return; }
      const first = !th.messages.some((m) => m.role === 'user');
      saveThread();
      if (first) chat.send(q.shown != null ? q.shown : q.content); else chat.send(q.content);
    }));
    $$('[data-copy]', log).forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(asMarkdown(+b.dataset.copy)); C.toast('Copied as Markdown. Paste it into an Obsidian note.'); } catch (e) { C.toast('The browser blocked the clipboard.'); }
    }));
    log.scrollTop = log.scrollHeight;
  }
  // global context (what's due, readiness) for chats without a study item
  function plannerContext() {
    const t = C.today();
    const dl = (C.deadlines ? C.deadlines() : []).filter((d) => d.date >= t && d.date <= C.addDays(t, 21));
    return 'Today is ' + C.fmtLong(t) + '. Upcoming deadlines (next 3 weeks):\n' + dl.map((d) => '- ' + d.date + ' (' + C.fmtShort(d.date) + ') ' + C.data.courseName(d.course) + ': ' + d.title + (d.notes ? ' (' + d.notes + ')' : '')).join('\n') +
      (C.study && C.study.masterySummary ? '\n\nQuiz mastery by lecture set (share of questions last answered right):\n' + C.study.masterySummary() : '') +
      (C.tasks ? '\n\nOpen tasks this week:\n' + C.tasks.sorted(C.tasks.all(7)).filter((x) => !x.doneAt).map((x) => '- ' + (x.due || 'no date') + ' ' + C.data.courseName(x.course) + ': ' + x.title).join('\n') : '') +
      (C.recovery && C.recovery.compute(t) ? '\n\nReadiness today: ' + C.recovery.compute(t).readiness + ' of 100 (' + C.recovery.label(C.recovery.compute(t).readiness)[0] + ').' : '') +
      // for each exam in the next three weeks: written practice done, and his own notes on its lectures
      (C.study && C.study.examUnits ? dl.filter((d) => d.kind === 'exam').map((e) => {
        const c = C.data.course(e.course);
        if (!c || !c.units) return '';
        const scope = c.units.filter((u) => C.study.examUnits(e).includes(u.id));
        const w = C.store.get('written', {}) || {};
        const total = scope.reduce((n, u) => n + (u.written || []).length, 0);
        const done = scope.reduce((n, u) => n + (u.written || []).filter((x) => (w[e.course + ':' + u.id + ':w' + C.hash(x.q)] || {}).a).length, 0);
        const notes = C.notes ? [...new Set(scope.flatMap((u) => C.notes.best(e.course, u, 1).map((n) => n.title)))] : [];
        return '\n\n' + C.data.courseName(e.course) + ' ' + e.title + ' (' + C.fmtShort(e.date) + '): written practice ' + done + ' of ' + total + ' problems answered (Carrel: each lecture\'s Written tab, or a mock exam with written problems).' +
          (notes.length ? ' My own notes on these lectures, in the Notes tab: ' + notes.join('; ') + '.' : '');
      }).join('') : '') +
      (C.study && C.study.dueCount ? '\n\nQuestions due for spaced review: ' + C.data.courses().filter((c) => c.units.length).map((c) => c.code + ' ' + C.study.dueCount(c.id)).join(', ') + '.' : '') +
      (function () { const al = C.data.vault().alab || {}; return al.source ? '\n\nA-Lab this week, from ' + al.source + ': my goals: ' + (al.mine || []).join('; ') + '. Team goals: ' + (al.group || []).join('; ') + '. Next milestones: ' + (al.milestones || []).filter((m) => m.date >= t).slice(0, 3).map((m) => m.date + ' ' + m.title).join('; ') + '.' : ''; })() +
      '\nCurrent time: ' + new Date().toTimeString().slice(0, 5) + '.';
  }
  C.plannerContext = plannerContext;
  // a failed or empty reply (and the question before it) is left out, so one error never breaks the thread
  function sendable(list) {
    const out = [];
    list.forEach((m) => {
      if (m.role === 'assistant' && (!m.content || m.error || m.content === '_Stopped._')) { if (out.length && out[out.length - 1].role === 'user') out.pop(); return; }
      out.push({ role: m.role, content: m.content });
    });
    // the API wants turns to alternate; fold any doubled user turns together
    return out.reduce((acc, m) => { const last = acc[acc.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else acc.push(m); return acc; }, []);
  }
  chat.send = async function (text) {
    if (chat.busy) chat.busy.abort();
    const th = loadThread();
    if (!$('#chatLog')) drawer.open('chat');
    const first = !th.messages.some((m) => m.role === 'user');
    let content = text;
    if (first) {
      const ctxText = th.ctx ? await C.contextBlock(th.ctx) : plannerContext();
      content = '<context>\n' + ctxText + '\n</context>\n\n' + text;
    }
    th.messages.push({ role: 'user', content, shown: text });
    const reply = { role: 'assistant', content: '', streaming: true };
    th.messages.push(reply);
    const ctrl = new AbortController();
    chat.busy = ctrl;
    chat.render();
    C.announce('Claude is replying.');
    chat.focus();
    try {
      await C.claude.stream({
        messages: sendable(th.messages.filter((m) => m !== reply)),
        signal: ctrl.signal,
        thread: th.id || (th.id = C.uid()),
        onText: (full) => { reply.content = full; drawLogThrottled(); },
      });
    } catch (e) {
      if (e.name !== 'AbortError') reply.error = e.message;
      if (!reply.content && e.name === 'AbortError') reply.content = '_Stopped._';
    }
    reply.streaming = false;
    if (chat.busy === ctrl) chat.busy = null;
    C.announce(reply.error ? C.friendlyError(reply.error) : 'Claude replied: ' + (reply.content || '').replace(/[#*$`>|]/g, '').slice(0, 600));
    saveThread();
    chat.render();
  };
  let rafPending = false;
  function drawLogThrottled() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; drawLog(); }); }

  // ================================================================ explain sheet
  const explain = { ctrl: null, ctx: null, text: '' };
  C.explain = function (ctx, anchor) {
    const el = $('#explain');
    if (explain.ctrl) explain.ctrl.abort();
    explain.ctx = ctx;
    explain.text = '';
    const title = ctx.selection ? (ctx.selection.length > 60 ? ctx.selection.slice(0, 57) + '…' : ctx.selection) : ctx.label || 'This concept';
    $('#explainTitle').textContent = title;
    if (el.hidden) explain.opener = document.activeElement;
    el.hidden = false;
    $('#explainTitle').setAttribute('tabindex', '-1');
    setTimeout(() => $('#explainTitle').focus({ preventScroll: true }), 0);
    place(el, anchor);
    const body = $('#explainBody');
    const sl = ctx.slide || (ctx.item && ctx.item.s);
    $('#explainSlide').hidden = !sl;
    $('#explainSlide').onclick = () => slides.open(sl[0], sl[1], { from: ctx.label });
    if (!C.claude.available()) {
      body.innerHTML = '<p>Claude is not connected. Start Carrel with "Start Carrel.cmd" (uses Claude Code on this machine), or add an Anthropic API key in Settings.</p>';
      return;
    }
    const cacheKey = C.hash(JSON.stringify([ctx.course, ctx.unit, ctx.kind, ctx.item && (ctx.item.q || ctx.item.f || ctx.item.n), ctx.selection, ctx.kind === 'quiz' ? ctx.picked != null : null]));
    const cache = C.store.get('explainCache', {});
    if (cache[cacheKey]) { show(cache[cacheKey].text, false); return; }
    body.innerHTML = '<div class="skel" aria-label="Claude is writing"><i></i><i></i><i></i></div>';
    const ctrl = (explain.ctrl = new AbortController());
    C.contextBlock(ctx).then((block) => {
      const unanswered = ctx.kind === 'quiz' && ctx.picked == null;
      explain.prompt = '<context>\n' + block + '\n</context>\n\n' + (ctx.selection ? 'Concept: "' + ctx.selection + '". ' : '') + C.EXPLAIN_ASK + (unanswered ? ' ' + C.EXPLAIN_SPOILER : '');
      return C.claude.stream({ messages: [{ role: 'user', content: explain.prompt }], signal: ctrl.signal, onText: (full) => show(full, true) });
    }).then((full) => {
      show(full, false);
      C.store.update('explainCache', {}, (c) => {
        c[cacheKey] = { text: full, at: Date.now() };
        const keys = Object.keys(c);
        if (keys.length > 300) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 300).forEach((k) => delete c[k]);
      });
    }).catch((e) => { if (e.name !== 'AbortError') body.innerHTML = '<p class="msg__err">' + esc(C.friendlyError(e)) + '</p>'; });

    function show(full, streaming) {
      explain.text = full;
      const m = full.match(/\n?\s*\**Go deeper:?\**:?\s*(.+)\s*$/i);
      const main = m ? full.slice(0, m.index) : full;
      const qs = m ? m[1].split('|').map((s) => s.trim().replace(/^[-*]\s*/, '')).filter(Boolean) : [];
      if (!streaming) C.announce('Explanation ready. ' + main.replace(/[#*$`>|]/g, '').slice(0, 500));
      C.html(body, C.md(main) + (qs.length && !streaming ? '<div class="suggest">' + qs.map((q) => '<button class="chip" type="button">' + esc(q) + '</button>').join('') + '</div>' : ''));
      if (streaming) body.lastElementChild && body.lastElementChild.classList.add('caret');
      $$('.suggest .chip', body).forEach((b) => (b.onclick = () => deeper(b.textContent)));
    }
  };
  function deeper(prompt) {
    const ctx = explain.ctx;
    $('#explain').hidden = true;
    if (explain.ctrl) explain.ctrl.abort();
    chat.open({
      ctx, label: ctx.label || ctx.selection,
      seed: explain.text ? { user: explain.prompt || C.EXPLAIN_ASK, shown: 'Explain ' + (ctx.selection ? '"' + ctx.selection + '"' : ctx.label || 'this concept') + ' at a high level.', assistant: explain.text } : null,
      prompt,
      send: !!prompt,
    });
    if (!explain.text && !prompt) chat.send('Explain ' + (ctx.selection ? '"' + ctx.selection + '"' : 'this') + ' at a high level, then check my understanding with one question.');
  }
  function place(el, anchor) {
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
    const w = Math.min(460, window.innerWidth - 32);
    let left = r ? r.left : window.innerWidth / 2 - w / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - w - 16));
    let top = r ? r.bottom + 10 : 120;
    const h = Math.min(window.innerHeight * 0.7, 620);
    if (top + h > window.innerHeight - 16) top = Math.max(16 + 56, (r ? r.top : 120) - h - 10);
    if (top < 72) top = 72;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function initExplain() {
    const el = $('#explain');
    const closeExplain = () => { el.hidden = true; if (explain.ctrl) explain.ctrl.abort(); const b = explain.opener; explain.opener = null; if (b && b.isConnected) b.focus({ preventScroll: true }); };
    explain.close = closeExplain;
    el.querySelector('[data-close]').onclick = closeExplain;
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeExplain(); } });
    $('#explainDeeper').onclick = () => deeper(null);
  }

  // ================================================================ highlight toolbar
  const sel = { ctx: null, rect: null };
  function ctxFrom(node) {
    const host = node && (node.nodeType === 1 ? node : node.parentElement);
    const el = host && host.closest('[data-ctx]');
    if (!el) return null;
    try { return JSON.parse(el.dataset.ctx); } catch (e) { return null; }
  }
  function resolve(ctx) {
    // data-ctx stores ids; turn them back into the item object
    if (!ctx) return ctx;
    if (ctx.ref && C.study && C.study.lookup) Object.assign(ctx, C.study.lookup(ctx.ref));
    return ctx;
  }
  C.ctxAttr = (o) => esc(JSON.stringify(o));
  function showTool() {
    const s = window.getSelection();
    const tool = $('#seltool');
    if (!s || s.isCollapsed || !s.rangeCount) { tool.hidden = true; return; }
    const text = s.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 700) { tool.hidden = true; return; }
    const range = s.getRangeAt(0);
    const ctx = ctxFrom(range.commonAncestorContainer);
    if (!ctx || (range.commonAncestorContainer.parentElement && range.commonAncestorContainer.parentElement.closest('input,textarea,#seltool'))) { tool.hidden = true; return; }
    sel.ctx = Object.assign({}, ctx, { selection: text });
    sel.rect = range.getBoundingClientRect();
    tool.hidden = false;
    tool.querySelector('[data-act="slide"]').hidden = !sel.ctx.course;
    const tw = tool.offsetWidth;
    const left = Math.max(8, Math.min(window.scrollX + sel.rect.left + sel.rect.width / 2 - tw / 2, window.scrollX + document.documentElement.clientWidth - tw - 8));
    const top = window.scrollY + sel.rect.top - tool.offsetHeight - 8;
    // on a touchscreen iOS puts its own Copy / Look Up menu above the selection, so ours goes below
    const touch = window.matchMedia('(pointer: coarse)').matches;
    tool.style.left = left + 'px';
    tool.style.top = (touch || top < window.scrollY + 60 ? window.scrollY + sel.rect.bottom + (touch ? 28 : 8) : top) + 'px';
  }
  function initSelection() {
    let t;
    document.addEventListener('selectionchange', () => { clearTimeout(t); t = setTimeout(showTool, 180); });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#seltool')) setTimeout(showTool, 0); });
    const tool = $('#seltool');
    tool.addEventListener('mousedown', (e) => e.preventDefault());
    tool.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || !sel.ctx) return;
      const ctx = resolve(sel.ctx);
      tool.hidden = true;
      const label = '"' + (ctx.selection.length > 48 ? ctx.selection.slice(0, 46) + '…' : ctx.selection) + '"' + (ctx.label ? ' in ' + ctx.label : '');
      ctx.label = label;
      if (b.dataset.act === 'explain') C.explain(ctx, sel.rect);
      else if (b.dataset.act === 'ask') chat.open({ ctx, label, send: false });
      else if (b.dataset.act === 'slide') {
        const unit = ctx.unit && C.data.unit(ctx.course, ctx.unit);
        const hit = await slides.find(ctx.selection, ctx.course, unit && unit.files);
        if (hit) slides.open(hit.fi, hit.p, { from: '"' + ctx.selection.slice(0, 30) + '"' });
        else C.toast('No slide mentions that phrase.');
      }
      window.getSelection().removeAllRanges();
    });
  }

  C.on('boot', () => {
    initFrame();
    initExplain();
    initSelection();
    const d = C.store.get('drawer');
    if (d && d.open && window.innerWidth > 1120) drawer.open(d.pane);
  });
  C.on('ready', () => { if (drawer.isOpen()) drawer.show(drawer.pane); });
})();
