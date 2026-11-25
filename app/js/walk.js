/* Lecture walkthrough: the deck page by page, each slide beside a short Claude note on what it says and why it matters.
   Claude annotates a whole deck in one call; the notes are cached per deck. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const walk = (C.walk = {});
  const KEY = 'walknotes';

  walk.notes = (k) => (C.store.get(KEY, {})[k] || null);

  walk.write = async function (fi, onStep) {
    const f = C.data.files()[fi];
    const text = await C.loadSlideText();
    const pages = text[fi] || [];
    const tagged = pages.map((p, i) => (p && p.length > 20 ? '[p.' + (i + 1) + ']\n' + p.slice(0, 1200) : '[p.' + (i + 1) + ']\n(no text, likely a figure)')).join('\n\n').slice(0, 52000);
    const course = C.data.course(f.c);
    onStep && onStep('Claude is reading ' + pages.length + ' pages…');
    const prompt = '<context>\nCourse: ' + course.code + ' ' + course.name + '\nDeck: ' + f.f + '\n\nSlide text, each page tagged [p.N]:\n' + tagged + '\n</context>\n\n' +
      'Write a walkthrough of this deck for exam review. For every page, one note of 1 to 3 sentences: what the slide says in plain words and why it matters, or "Title page", "Section divider" or "Figure: <what it likely shows>" when that is all there is. Mark with "key": true only the pages an exam is most likely to test, about a quarter of the deck and never more than a third. Use LaTeX in $...$ for math. ' +
      'Return ONLY a JSON array with one object per page in order: [{"p": page number, "note": string, "key": boolean}]. No prose, no code fence.';
    let n = 0;
    const raw = await C.claude.stream({ messages: [{ role: 'user', content: prompt }], onText: (full) => { const k = (full.match(/"p"\s*:/g) || []).length; if (k !== n) { n = k; onStep && onStep('Annotating page ' + k + ' of ' + pages.length + '…'); } } });
    const a = raw.indexOf('['), b = raw.lastIndexOf(']');
    let arr;
    try { arr = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error('Claude’s notes were not valid JSON. Try again.'); }
    const notes = {};
    arr.forEach((x) => { if (x && x.p && x.note) notes[x.p] = { note: String(x.note), key: !!x.key }; });
    if (!Object.keys(notes).length) throw new Error('Claude returned no notes. Try again.');
    C.store.update(KEY, {}, (m) => { m[f.k] = { notes, at: C.today() }; m._t = Date.now(); });
    return notes;
  };

  // the view lives in the Study area: #/walk/<file index>?p=<page>
  C.routes.walk = {
    title: 'Walkthrough',
    render(main, r) {
      const files = C.data.files();
      const fi = +r.parts[0];
      const f = files[fi];
      if (!f) { main.innerHTML = '<div class="page"><div class="state"><h3>Pick a lecture to walk through</h3><p>Open a lecture’s Brief and choose "Walk through the slides".</p></div></div>'; return; }
      const course = C.data.course(f.c);
      const unit = course && course.units ? course.units.find((u) => (u.files || [])[0] === fi) || course.units.find((u) => (u.files || []).includes(fi)) : null;
      const saved = walk.notes(f.k);
      const p = Math.min(Math.max(1, +r.q.p || 1), f.n);
      const keyOnly = r.q.key === '1';
      const notes = saved ? saved.notes : null;
      const keyPages = notes ? Object.keys(notes).filter((k) => notes[k].key).map(Number).sort((x, y) => x - y) : [];
      const seq = keyOnly && keyPages.length ? keyPages : Array.from({ length: f.n }, (_, i) => i + 1);
      const at = Math.max(0, seq.indexOf(p));
      const goTo = (q) => C.setQuery({ p: q }) || C.render();
      main.innerHTML =
        '<div class="page walk"><div class="phead"><div><div class="uhead__meta"><span class="ctag c-' + f.c + '">' + esc(course ? course.code + ' ' + course.short : '') + '</span><span>' + esc(C.fileShort(f)) + '</span></div><h1>' + esc(unit ? unit.title : f.f.replace(/\.pdf$/i, '')) + '</h1></div>' +
        '<div class="phead__tools">' + (notes ? '<button class="chip" type="button" id="wkKey" aria-pressed="' + keyOnly + '">Key pages only (' + keyPages.length + ')</button>' : '') + '<button class="btn" type="button" id="wkBack">Back</button></div></div>' +
        '<div class="walk__grid"><div class="walk__slide" id="wkStage"><div class="slideskel" style="aspect-ratio:' + (f.ar || 1.333) + '"></div></div>' +
        '<aside class="walk__note" data-ctx="' + C.ctxAttr({ course: f.c, kind: 'slide', slide: [fi, p], label: C.fileShort(f) + ' p.' + p }) + '">' +
        '<div class="walk__pg">Page ' + p + ' of ' + f.n + (notes && notes[p] && notes[p].key ? ' <span class="chip" aria-pressed="true">likely on the exam</span>' : '') + '</div>' +
        (notes ? '<div class="prose" id="wkNote">' + (notes[p] ? C.md(notes[p].note) : '<p class="muted">No note for this page.</p>') + '</div>'
          : '<div class="state"><h3>No walkthrough notes yet</h3><p>Claude reads the whole deck once and writes a short note for every page, marking the ones an exam is likely to test. About a minute; kept for next time.</p><div class="qactions"><button class="btn btn--primary" type="button" id="wkWrite">' + C.icon.spark + ' Write the notes</button><span class="muted" id="wkStep" role="status"></span></div></div>') +
        '<div class="qactions"><button class="btn" type="button" id="wkPrev"' + (at <= 0 ? ' disabled' : '') + '>' + C.icon.left + ' Previous</button><button class="btn btn--primary" type="button" id="wkNext"' + (at >= seq.length - 1 ? ' disabled' : '') + '>Next ' + C.icon.right + '</button>' +
        '<button class="btn btn--sm btn--quiet" type="button" id="wkAsk">' + C.icon.chat + ' Ask about this page</button></div>' +
        '<p class="muted walk__hint"><kbd>←</kbd> <kbd>→</kbd> move. Highlight anything on the slide or in the note to explain it.</p></aside></div></div>';
      C.renderMath(main);
      // the slide, drawn the same way as the side panel (pdf.js, with selectable text)
      const tok = (walk._tok = (walk._tok || 0) + 1);
      (async () => {
        if (!C.server.checked) await new Promise((res) => C.on('ready', res)); // the server probe has not answered yet
        const stage = $('#wkStage');
        if (!stage || tok !== walk._tok) return;
        if (!(C.server.ok && window.pdfjsLib)) {
          const url = C.slides.fileUrl(f, p);
          stage.innerHTML = url ? '<iframe title="' + esc(f.f) + ', page ' + p + '" src="' + esc(url) + '"></iframe>' : '<p class="muted">Start Carrel with Start Carrel.cmd to see slides here.</p>';
          return;
        }
        try {
          const node = await C.slides.pageNode(fi, p, stage.clientWidth);
          if (tok !== walk._tok || !$('#wkStage')) return;
          stage.innerHTML = '';
          stage.appendChild(node);
        } catch (e) { stage.innerHTML = '<p class="muted">Could not draw this page.</p>'; }
      })();
      $('#wkBack').onclick = () => history.back();
      $('#wkPrev').onclick = () => goTo(seq[at - 1]);
      $('#wkNext').onclick = () => goTo(seq[at + 1]);
      $('#wkAsk').onclick = () => C.chat.open({ ctx: { course: f.c, kind: 'slide', slide: [fi, p] }, label: C.fileShort(f) + ' p.' + p, prompt: 'Walk me through this slide in more depth: the reasoning, an example, and how it could show up on the exam.' });
      if ($('#wkKey')) $('#wkKey').onclick = () => { C.setQuery({ key: keyOnly ? '' : '1', p: keyOnly ? p : keyPages[0] || p }); C.render(); };
      if ($('#wkWrite')) $('#wkWrite').onclick = async (e) => {
        if (!C.claude.available()) { C.toast('Claude is not connected. Start Carrel with Start Carrel.cmd, or add an API key in Settings.'); return; }
        e.currentTarget.disabled = true;
        try { await walk.write(fi, (s) => { const el = $('#wkStep'); if (el) el.textContent = s; }); C.render(); }
        catch (err) { const el = $('#wkStep'); if (el) el.textContent = C.friendlyError(err); const b = $('#wkWrite'); if (b) b.disabled = false; }
      };
      walk.keys = (e) => {
        if (e.key === 'ArrowRight' && at < seq.length - 1) { goTo(seq[at + 1]); return true; }
        if (e.key === 'ArrowLeft' && at > 0) { goTo(seq[at - 1]); return true; }
        return false;
      };
    },
  };
  document.addEventListener('keydown', (e) => {
    if (C._lastView !== 'walk' || !walk.keys || !C.shortcutsOn()) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button, a, dialog, #drawer')) return;
    if (walk.keys(e)) e.preventDefault();
  });
})();
