/* Your own vault notes (Efforts/Exams and Atlas/Concepts) beside the lectures they cover: listed in each lecture's
   brief and read in the side panel, with wikilinks and "p. 12" page references opening the slides. The local server
   sends a note's text; without it the list still opens each note in Obsidian. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const N = (C.notes = { current: null, cache: {}, at: {}, scroll: {}, filter: '' });

  N.all = () => C.data.vault().notes || [];
  N.byPath = (p) => N.all().find((n) => n.path === p);
  const base = (p) => String(p).split('/').pop();
  // a full vault path is exact; a bare file name ("Recitation4.pdf" exists for two courses) prefers the note's course
  const fileIndex = (k, course) => {
    const files = C.data.files();
    if (/\//.test(k)) { const i = files.findIndex((f) => f.k === k); if (i >= 0) return i; }
    const i = files.findIndex((f) => f.f === base(k) && f.c === course);
    return i >= 0 ? i : files.findIndex((f) => f.f === base(k));
  };
  // a note belongs to a lecture when it names it (Lec 10, L8-L9, Rec 6); a note that names none of this course's
  // lectures, when it cites their slides
  N.forUnit = (cid, u) => {
    const labels = new Set(((C.data.course(cid) || {}).units || []).map((x) => x.label));
    return N.all().filter((n) => n.course === cid && (n.labels.some((l) => labels.has(l)) ? n.labels.includes(u.label)
      : n.pdfs.some((k) => (u.files || []).some((fi) => (C.data.files()[fi] || {}).k === k))));
  };
  // the notes worth opening after a question: your own summaries before your flashcard lists
  const RANK = ['Cheat sheet', 'Review', 'Notes', 'Concept', 'Practice', 'Quiz', 'Flashcards', 'Index', 'To review'];
  // and a note that names this lecture before one that only cites its slides
  N.best = (cid, u, k) => {
    const spec = (n) => (n.labels.includes(u.label) ? n.labels.length : 99);
    // among notes that only cite the slides, the one that cites fewest decks is the most focused
    const focus = (n) => (spec(n) === 99 ? n.pdfs.length : 0);
    // and the note written mainly about this lecture (named first, as in "Lec9 Cheat Sheet") before one that also covers it
    const main = (n) => (n.labels[0] === u.label ? 0 : 1);
    return N.forUnit(cid, u).slice().sort((a, b) => (spec(a) === 99) - (spec(b) === 99) || main(a) - main(b) || RANK.indexOf(a.kind) - RANK.indexOf(b.kind) || spec(a) - spec(b) || focus(a) - focus(b)).slice(0, k);
  };
  N.obsidian = (n) => {
    const vault = base(String(C.data.vault().vaultPath || 'MBAn').replace(/\\/g, '/'));
    return 'obsidian://open?vault=' + encodeURIComponent(vault) + '&file=' + encodeURIComponent(n.path.replace(/\.md$/, ''));
  };

  // you may be editing the note in Obsidian at the same time: text older than two minutes is read again
  const FRESH = 120000;
  N.load = async function (path) {
    if (N.cache[path] != null && Date.now() - (N.at[path] || 0) < FRESH) return N.cache[path];
    try {
      const r = await C.api('/api/note?path=' + encodeURIComponent(path));
      N.cache[path] = r.text;
      N.at[path] = Date.now();
    } catch (e) { if (N.cache[path] == null) throw e; }
    return N.cache[path];
  };

  // all notes at once for search, fetched once a session (they are small) and on demand after that
  N.loadAll = function () {
    if (!C.server.ok) return Promise.resolve(false);
    if (N._all && Date.now() - N._allAt > FRESH) N._all = null;
    if (!N._all) {
      N._allAt = Date.now();
      N._all = C.api('/api/notes').then((m) => { Object.assign(N.cache, m); Object.keys(m).forEach((p) => (N.at[p] = N._allAt)); return true; }).catch(() => { N._all = null; return false; });
    }
    return N._all;
  };
  const plain = (s) => s.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, ' ').replace(new RegExp(C.MATH1, 'g'), ' ').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*_`>#|]/g, ' ').replace(/\s+/g, ' ').trim();
  // sections of your notes that contain every word of a search, best few per note
  N.search = async function (qs, limit) {
    if (!(await N.loadAll())) return [];
    // whole-word starts, so "dual" finds "dual norm" and not "residual"
    const res = qs.map((w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const hits = [];
    N.all().forEach((n) => {
      const text = N.cache[n.path];
      if (!text) return;
      let k = 0;
      text.replace(/^---\n[\s\S]*?\n---\n?/, '').split(/\n(?=#{1,4} )/).forEach((sec) => {
        if (k >= 2) return;
        const low = sec.toLowerCase();
        if (!res.every((r) => r.test(low))) return;
        const head = /^#{1,4} /.test(sec) ? sec.slice(0, sec.indexOf('\n') > 0 ? sec.indexOf('\n') : undefined).replace(/^#+\s*/, '') : '';
        const body = plain(sec.slice(head ? sec.indexOf('\n') + 1 : 0));
        const m = res[0].exec(body.toLowerCase());
        const i = Math.max(0, (m ? m.index : 0) - 50);
        hits.push({ n, head: plain(head), snip: (i ? '…' : '') + body.slice(i, i + 140), exact: qs.length > 1 && low.replace(/[\s-]+/g, ' ').includes(qs.join(' ')) });
        k++;
      });
    });
    // sections with the exact phrase first
    return hits.filter((h) => h.exact).concat(hits.filter((h) => !h.exact)).slice(0, limit);
  };

  // the section of a note a highlight came from, so Claude reads your words around it
  // (min > 0: only a section that clearly matches, else nothing)
  N.excerpt = function (path, sel, max, min) {
    const text = N.cache[path];
    if (!text) return '';
    const secs = text.replace(/^---\n[\s\S]*?\n---\n?/, '').split(/\n(?=#{1,4} )/).map((s) => ({ s, low: s.toLowerCase(), head: s.slice(0, s.indexOf('\n') + 1 || undefined).toLowerCase() }));
    const best = rank(secs, sel);
    if (!best || best.score < (min || 0)) return min ? '' : secs[0].s.slice(0, max || 3000);
    return best.s.s.slice(0, max || 3000);
  };
  // the lecture's best note, at the section closest to a question, for Claude's context
  N.sectionFor = async function (cid, u, text) {
    if (!C.server.ok || !u) return null;
    const n = N.best(cid, u, 1)[0];
    if (!n) return null;
    try { await N.load(n.path); } catch (e) { return null; }
    const ex = N.excerpt(n.path, text, 1800, 2);
    return ex ? { n, text: ex } : null;
  };

  function toHtml(n, text) {
    // Two kinds of placeholder: \u0003 keeps source the rewrites below must not touch (code, math, markdown links)
    // and goes back before the markdown renderer runs; \u0002 is finished HTML and goes in after it.
    const toks = [], raws = [];
    const tok = (h) => { toks.push(h); return '\u0002' + (toks.length - 1) + '\u0002'; };
    const raw = (src) => { raws.push(src); return '\u0003' + (raws.length - 1) + '\u0003'; };
    const primary = n.primary ? fileIndex(n.primary, n.course) : -1;
    let s = text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n?/, '');
    s = s.replace(/^```[\s\S]*?^```[^\n]*$/gm, raw).replace(/`[^`\n]+`/g, raw);
    // Obsidian's MathJax knows psmallmatrix and bsmallmatrix; KaTeX only smallmatrix
    s = s.replace(/\\begin\{([pb])smallmatrix\}/g, (_, k) => (k === 'p' ? '\\left(' : '\\left[') + '\\begin{smallmatrix}')
      .replace(/\\end\{([pb])smallmatrix\}/g, (_, k) => '\\end{smallmatrix}' + (k === 'p' ? '\\right)' : '\\right]'));
    // \$ outside math is a literal dollar; inside math KaTeX wants \char36
    s = s.replace(new RegExp(String.raw`(\\\$)|(\$\$[\s\S]+?\$\$|` + C.MATH1 + ')', 'g'), (m, esc$, math) => (esc$ ? tok('<span>$</span>') : raw(math.replace(/\\\$/g, '\\char36 '))));
    s = s.replace(/\]\([^)\s]+\)/g, raw);                                        // markdown link targets
    s = s.replace(/^(#[\w/-]+\s*)+$/gm, '');                                    // tag-only lines
    s = s.replace(/^>\s*\[!(\w+)\][-+]?\s*(.*)$/gm, (_, k, t) => '> **' + (t || k) + '**');   // callouts
    // Spaced Repetition cards: "term::definition", and a question over a lone "?" line
    s = s.replace(/^(?![\s|>#-]|```)([^\n:]{1,200}?)\s*:{2,3}\s*(\S.*)$/gm, (_, t, d) => (t.includes('*') ? t : '**' + t + '**') + ': ' + d);
    s = s.replace(/^(?![\s|>#-]|```)([^\n]+)\n\?{1,2}\n/gm, (_, q) => (q.includes('*') ? q : '**' + q + '**') + '\n');
    s = s.replace(/^(\s*[-*+]\s+)\[([ xX])\]\s+/gm, (_, b, x) => b + (x === ' ' ? '☐ ' : '☑ '));
    s = s.replace(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, (_, t) => tok('<span class="muted">(' + esc(base(t)) + ')</span>'));
    s = s.replace(/\[\[([^\]|#]+?)\\?(?:#([^\]|]*))?(?:\\?\|([^\]]*))?\]\]/g, (_, t, h, a) => {
      t = t.trim();
      const label = (a || '').trim() || base(t).replace(/\.(md|pdf)$/i, '');
      if (/\.pdf$/i.test(t)) {
        const fi = fileIndex(t, n.course);
        const pg = h && /page=(\d+)/.exec(h);
        return tok(fi >= 0 ? '<button class="linkbtn" type="button" data-sl="' + fi + ',' + (pg ? pg[1] : 1) + '">' + esc(label) + '</button>' : esc(label));
      }
      const hit = N.all().find((x) => base(x.path) === base(t) + '.md');
      return tok(hit ? '<button class="linkbtn" type="button" data-note="' + esc(hit.path) + '">' + esc(label) + '</button>' : esc(label));
    });
    // "p. 12", "pp. 2-4" and "p12" are PDF pages of the one deck the note is written from, where the note says so;
    // math is skipped, and notes that cite printed slide numbers keep their refs as text
    if (primary >= 0 && n.pages) {
      const pages = C.data.files()[primary].n;
      s = s.replace(/\b(pp?\.\s?|p)(\d{1,3})(\s?[–-]\s?\d{1,3})?\b/g, (m, p, a, rest) => (!(+a >= 1 && +a <= pages) ? m
        : tok('<button class="linkbtn" type="button" data-sl="' + primary + ',' + a + '" title="Open slide ' + a + '">' + esc(p + a + (rest || '')) + '</button>')));
    }
    s = s.replace(/==([^=\n]+)==/g, (_, x) => tok('<mark>' + esc(x) + '</mark>'));
    // put source back for the renderer (a placeholder may hold another), render, then swap in the HTML, nested ones too
    const unraw = (x) => { while (/\u0003\d+\u0003/.test(x)) x = x.replace(/\u0003(\d+)\u0003/g, (_, i) => raws[+i]); return x; };
    let h = C.md(unraw(s));
    for (let k = 0; k < 6 && /[\u0002\u0003]\d+[\u0002\u0003]/.test(h); k++) h = h.replace(/\u0002(\d+)\u0002/g, (_, i) => toks[+i]).replace(/\u0003(\d+)\u0003/g, (_, i) => esc(raws[+i]));
    return h;
  }

  function listView(el) {
    const route = C.route || {};
    const here = route.view === 'study' && route.parts && route.parts[1] ? C.data.unit(route.parts[0], route.parts[1]) : null;
    const mine = here ? N.best(route.parts[0], here, 99) : [];
    const q = N.filter.toLowerCase().trim();
    const match = (n) => !q || (n.title + ' ' + n.kind + ' ' + n.labels.join(' ') + ' ' + C.data.courseName(n.course)).toLowerCase().includes(q);
    const row = (n) => '<li><button class="notelist__item" type="button" data-note="' + esc(n.path) + '"><span>' + esc(n.title) + '</span><span class="muted">' + esc(n.kind) + ', ' + esc(C.fmtShort(n.mtime)) + '</span></button></li>';
    const groups = (C.data.vault().courses || []).map((c) => [c, N.all().filter((n) => n.course === c.id && match(n))]).filter(([, ns]) => ns.length);
    const other = N.all().filter((n) => !n.course && match(n));
    el.innerHTML = '<div class="notes"><div class="notes__bar"><label class="visually-hidden" for="noteFilter">Filter your notes</label><input class="notes__filter" id="noteFilter" type="search" placeholder="Filter your notes" value="' + esc(N.filter) + '" autocomplete="off"></div>' +
      '<div class="notes__body">' +
      (!N.all().length ? '<p class="muted">No notes found in Efforts/Exams or Atlas/Concepts.</p>' : '') +
      (mine.length && !q ? '<section><h3>For ' + esc(here.label + ' ' + here.short) + '</h3><ul class="notelist">' + mine.map(row).join('') + '</ul></section>' : '') +
      groups.map(([c, ns]) => '<section><h3>' + esc(c.code + ' ' + c.short) + '</h3><ul class="notelist">' + ns.map(row).join('') + '</ul></section>').join('') +
      (other.length ? '<section><h3>Other</h3><ul class="notelist">' + other.map(row).join('') + '</ul></section>' : '') +
      (q && !groups.length && !other.length ? '<p class="muted">No note matches that.</p>' : '') + '</div></div>';
    const f = $('#noteFilter', el);
    f.oninput = () => { N.filter = f.value; const pos = f.selectionStart; listView(el); const g = $('#noteFilter', el); g.focus(); g.setSelectionRange(pos, pos); };
  }

  // the heading whose section shares the most words with a question and its explanation
  const STOP = new Set(('this that with from what which when where there their they them then than have does into over under about would could should each only also more most some such very will your these those been being were other while ' +
    'must come comes matter matters select given true false following statement correct best describes mainly because gives uses using used means reading holds why').split(' '));
  // sections ({low, head}) scored by the words they share with a text: a word the whole note uses says little,
  // a word only one section uses says a lot, more so in its heading; long sections are discounted
  // Text after the first line break (an explanation) counts half: the question names the topic.
  function rank(secs, text) {
    const split = (s) => s.toLowerCase().replace(new RegExp(C.MATH1, 'g'), ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
    const [strong, ...rest] = String(text || '').split('\n');
    const wt = {};
    split(rest.join(' ')).forEach((w) => (wt[w] = 0.5));
    split(strong).forEach((w) => (wt[w] = 1));
    const words = Object.keys(wt);
    if (words.length < 2 || !secs.length) return null;
    const idf = {};
    words.forEach((w) => (idf[w] = wt[w] * Math.log(1 + secs.length / (1 + secs.filter((s) => s.low.includes(w)).length))));
    let best = null, top = 0;
    secs.forEach((s) => {
      const score = words.reduce((n, w) => n + (s.low.includes(w) ? idf[w] * (s.head.includes(w) ? 2 : 1) : 0), 0) / Math.sqrt(1 + s.low.length / 3000);
      if (score > top) { top = score; best = s; }
    });
    return best ? { s: best, score: top } : null;
  }
  const norm = (s) => s.replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
  function locate(body, text, heading) {
    if (heading) {
      // a search hit names its heading: match it with the math left out
      const want = norm(heading);
      const h = want && $$('h3, h4', body).find((x) => { const c = x.cloneNode(true); $$('.katex', c).forEach((k) => k.remove()); return norm(c.textContent) === want; });
      if (h) return h;
    }
    const secs = $$('h3, h4', body).map((h) => {
      let txt = h.textContent, x = h.nextElementSibling;
      while (x && !/^H[34]$/.test(x.tagName)) { txt += ' ' + x.textContent; x = x.nextElementSibling; }
      return { h, low: txt.toLowerCase(), head: h.textContent.toLowerCase() };
    });
    const best = rank(secs, text);
    return best && best.score >= 2 ? best.s.h : null;
  }

  async function noteView(el, n) {
    const head = '<div class="notes__bar"><button class="btn btn--sm btn--quiet" type="button" id="noteBack">All notes</button>' +
      '<span class="notes__title"><b>' + esc(n.title) + '</b><span class="muted">' + esc(C.data.courseName(n.course) + ', ' + n.kind.toLowerCase() + ', edited ' + C.fmtShort(n.mtime)) + '</span></span>' +
      '<a class="btn btn--sm" href="' + esc(N.obsidian(n)) + '">Open in Obsidian</a></div>';
    el.innerHTML = '<div class="notes">' + head + '<article class="notes__body prose" id="noteBody" tabindex="-1" data-ctx="' + C.ctxAttr({ course: n.course, kind: 'vnote', label: n.title, vnote: n.path }) + '">' +
      (C.server.ok ? '<div class="skel" aria-label="Loading the note"><i></i><i></i><i></i></div>' : '<p>The note opens here when Carrel runs with its local server (Start Carrel.cmd). It still opens in Obsidian.</p>') + '</article></div>';
    $('#noteBack', el).onclick = () => { N.current = null; C.store.set('note', null); N.mount(el); const f = $('#noteFilter', el); f && f.focus(); };
    if (!C.server.ok) return;
    try {
      const text = await N.load(n.path);
      const body = $('#noteBody', el);
      if (N.current !== n.path || !body) return;
      body.innerHTML = toHtml(n, text);
      C.renderMath(body);
      // opened from a question: go to the section that covers it; back from a slide: pick up where you were reading
      const at = N.find && N.find.path === n.path ? locate(body, N.find.text, N.find.heading) : null;
      N.find = null;
      if (at) {
        body.scrollTop = at.offsetTop - body.offsetTop - 8;
        at.classList.add('is-found');
        C.announce && C.announce('Opened at ' + at.textContent);
      } else body.scrollTop = N.scroll[n.path] || 0;
      body.onscroll = () => (N.scroll[n.path] = body.scrollTop);
    } catch (e) {
      // a slow failure for a note you have since left must not take over the panel
      if (N.current !== n.path || !$('#noteBody', el)) return;
      $('#noteBody', el).innerHTML = '<p class="msg__err">' + esc(C.friendlyError ? C.friendlyError(e) : e.message) + '</p><p><button class="btn btn--sm" type="button" id="noteRetry">Try again</button></p>';
      $('#noteRetry', el).onclick = () => { N.current = n.path; noteView(el, n); };
    }
  }

  N.mount = function (el) {
    const n = N.current && N.byPath(N.current);
    if (n) noteView(el, n); else listView(el);
  };
  N.open = function (path, find, heading) {
    N.current = path;
    N.find = find || heading ? { path, text: find || '', heading } : null;
    C.store.set('note', path);
    if (C.drawer.isOpen() && C.drawer.pane === 'notes') N.mount($('#paneNotes'));
    else C.drawer.open('notes');
    setTimeout(() => { const b = $('#noteBody'); b && b.focus({ preventScroll: true }); }, 0);
  };

  // brief section: the notes you wrote on this lecture
  N.section = function (cid, u) {
    const mine = N.best(cid, u, 99);
    if (!mine.length) return '';
    return '<section><h2>Your notes</h2><div class="decks">' + mine.map((n) => '<div class="deckrow deckrow--note"><span>' + esc(n.title) + ' <span class="muted">' + esc(n.kind.toLowerCase()) + ', edited ' + esc(C.fmtShort(n.mtime)) + '</span></span>' +
      '<button class="btn btn--sm" type="button" data-note="' + esc(n.path) + '">Read in the panel</button></div>').join('') + '</div></section>';
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-note]');
    if (b) { e.preventDefault(); N.open(b.dataset.note, b.dataset.find); return; }
    const s = e.target.closest && e.target.closest('#paneNotes [data-sl]');
    if (s) { const [fi, p] = s.dataset.sl.split(',').map(Number); C.slides.open(fi, p, { from: (N.byPath(N.current) || {}).title }); }
  });
  C.on('boot', () => { N.current = C.store.get('note') || null; });
})();
