/* New lecture PDFs: the server lists vault PDFs the built data has never seen; Claude turns one into a study set.
   Sets are kept in the store with their slide text, merged into the course on every load, and linked to their pages. */
(function () {
  'use strict';
  const C = window.C;
  const { $, esc } = C;
  const nd = (C.newdecks = { list: [] });
  const KEY = 'genunits';

  const saved = () => C.store.get(KEY, []) || [];
  const fileIndex = (k) => C.data.files().findIndex((f) => f.k === k);

  // lecture number in a file name: "Lecture 19 …", "…_Lecture19.pdf", "…-L15.pdf", "…_Lec9.pdf" (not the l in "Fall_2026")
  const lectureNo = (name) => {
    const m = String(name).match(/(?:^|[^a-z])(?:lecture|lec|l)[\s_-]*(\d{1,2})(?!\d)/i);
    return m ? +m[1] : null;
  };
  // A set's PDF can be renamed or replaced in the vault after Claude built the set (a Canvas download later saved
  // under its real title, say). The old path then 404s and every slide link in the set fails. If the built data has
  // a deck in the same course with the same lecture number and page count, point the set at it and remember that.
  function relink(g, all) {
    if (fileIndex(g.file.k) >= 0) return false;
    const n = lectureNo(g.file.f);
    if (n == null) return false;
    const twin = C.data.files().find((f) => f.c === g.course && f.n === g.file.n && lectureNo(f.f) === n);
    if (!twin) return false;
    g.file = { ...twin };
    C.store.set(KEY, all);
    return true;
  }

  // fold saved sets into the decks: register their PDF, then their unit, with slide refs pointing at it
  nd.apply = function () {
    const all = saved();
    all.forEach((g) => relink(g, all));
    all.forEach((g) => {
      let fi = fileIndex(g.file.k);
      if (fi < 0) { window.CARREL_FILES.push(g.file); fi = window.CARREL_FILES.length - 1; }
      if (C.slideText && !C.slideText[fi]) fetchText(fi, g.file.k);
      const c = C.data.course(g.course);
      if (!c || !c.units) return;
      // once a rebuild includes this deck, the built set wins and this one steps aside
      if (c.units.some((x) => !x.id.startsWith('g') && (x.files || []).includes(fi))) return;
      if (c.units.some((x) => x.id === g.unit.id && !x.saved)) return; // exported to build/extra and rebuilt: the built copy wins
      const u = JSON.parse(JSON.stringify(g.unit));
      const ref = (x) => { const m = String(x.ref || '').match(/p\.?\s*(\d+)/); return m ? [fi, Math.min(+m[1], g.file.n)] : null; };
      u.files = [fi];
      u.new = true;
      u.saved = true;
      (u.cards || []).forEach((x) => (x.s = ref(x)));
      (u.quiz || []).forEach((x) => { x.s = ref(x); x.a = x.a || 0; x.d = x.d || 'medium'; });
      (u.written || []).forEach((x) => (x.s = ref(x)));
      const at = c.units.findIndex((x) => x.id === u.id);
      if (at >= 0) c.units[at] = u; else c.units.push(u);
    });
    if (C.generate) C.generate.apply();
  };
  // page text for these decks stays on the server (its pdftext cache); fetched when slide text is first needed
  const pending = {};
  function fetchText(fi, k) {
    if (pending[k] || !C.server.ok) return;
    pending[k] = C.api('/api/pdftext?path=' + encodeURIComponent(k)).then((t) => { if (C.slideText && t.pages) C.slideText[fi] = t.pages; }).catch(() => {});
  }
  const loadText = C.loadSlideText;
  C.loadSlideText = () => loadText().then((t) => { nd.apply(); return t; });

  nd.refresh = async function () {
    if (!C.server.ok) return;
    try {
      const have = new Set(saved().map((g) => g.file.k).concat(C.data.files().map((f) => f.k)));
      nd.list = (await C.api('/api/newdecks')).filter((d) => !have.has(d.path));
      if (nd.list.length) C.emit('newdecks');
    } catch (e) { nd.list = []; }
  };
  nd.forCourse = (cid) => nd.list.filter((d) => d.course === cid);

  nd.build = async function (deck, onStep) {
    onStep && onStep('Reading the PDF…');
    const t = await C.api('/api/pdftext?path=' + encodeURIComponent(deck.path));
    if (t.error) throw new Error(t.error);
    const text = t.pages.map((p, i) => (p && p.length > 30 ? '[p.' + (i + 1) + ']\n' + p.slice(0, 1500) : '')).filter(Boolean).join('\n\n').slice(0, 48000);
    if (text.length < 400) throw new Error('This PDF has almost no extractable text (it may be scanned images).');
    const course = C.data.course(deck.course);
    const label = C.fileShort({ f: deck.file });
    onStep && onStep('Claude is writing the set…');
    const prompt = '<context>\nCourse: ' + course.code + ' ' + course.name + '\nNew lecture deck: ' + deck.file + '\n\nSlide text, each page tagged [p.N]:\n' + text + '\n</context>\n\n' +
      'Write an exam-prep study set for this lecture, grounded only in the slides. Return ONLY one JSON object, no prose, no code fence:\n' +
      '{"title": lecture title, "short": 2-4 word name, "brief": 4-6 sentence summary, "kp": [8-10 one-line key points], "topics": [{"n": name, "x": 2-3 sentence explanation}] (4-7, in lecture order), ' +
      '"cards": [{"f": front, "b": back, "x": one-line intuition or trap, "t": topic index, "ref": "p.N"}] (12-16), ' +
      '"quiz": [{"q": question, "o": [correct, wrong, wrong, wrong], "e": why right and why the tempting option is wrong, "d": "easy"|"medium"|"hard", "t": topic index, "ref": "p.N"}] (15-18, correct option first, about 30% easy, 45% medium, 25% hard, several needing a small calculation or formulation reasoning), ' +
      '"written": [{"q": exam-style open question, "m": model answer, "k": [rubric points], "t": topic index}] (2)}.\nUse LaTeX between $...$ for math. Leave out anything the slide text does not support.';
    let n = 0;
    const raw = await C.claude.stream({ messages: [{ role: 'user', content: prompt }], onText: (full) => { const k = (full.match(/"q"\s*:/g) || []).length; if (k !== n) { n = k; onStep && onStep('Claude is writing question ' + k + '…'); } } });
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    let u;
    try { u = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error('Claude’s reply was not valid JSON. Try again.'); }
    if (!u || !Array.isArray(u.quiz) || !u.quiz.length) throw new Error('Claude returned no questions. Try again.');
    const str = (x) => typeof x === 'string' && x.trim().length > 0;
    const topics = Array.isArray(u.topics) ? u.topics.filter((x) => x && str(x.n)).map((x) => ({ n: x.n, x: str(x.x) ? x.x : '' })) : [];
    const tIdx = (t) => (Number.isInteger(t) && t >= 0 && t < Math.max(1, topics.length) ? t : 0);
    const unit = {
      id: 'g' + C.hash(deck.path), label, title: str(u.title) ? u.title : deck.file.replace(/\.pdf$/i, ''), short: str(u.short) ? u.short : label, src: deck.file,
      brief: str(u.brief) ? u.brief : '', kp: Array.isArray(u.kp) ? u.kp.filter(str) : [], topics: topics.length ? topics : [{ n: label }],
      cards: (Array.isArray(u.cards) ? u.cards : []).filter((x) => x && str(x.f) && str(x.b)).map((x) => ({ f: x.f, b: x.b, x: str(x.x) ? x.x : '', t: tIdx(x.t), ref: String(x.ref || '') })),
      quiz: u.quiz.filter((x) => x && str(x.q) && Array.isArray(x.o) && x.o.length >= 3 && x.o.every(str)).map((x) => ({ q: x.q, o: x.o.slice(0, 5), a: 0, e: str(x.e) ? x.e : '', d: ['easy', 'medium', 'hard'].includes(x.d) ? x.d : 'medium', t: tIdx(x.t), ref: String(x.ref || '') })),
      written: (Array.isArray(u.written) ? u.written : []).filter((x) => x && str(x.q)).map((x) => ({ q: x.q, m: str(x.m) ? x.m : '', k: Array.isArray(x.k) ? x.k.filter(str) : [], t: tIdx(x.t) })),
    };
    if (!unit.quiz.length) throw new Error('Claude returned no usable questions. Try again.');
    const file = { k: deck.path, f: deck.file, c: deck.course, n: t.n, ar: t.ar || 1.333 };
    C.store.update(KEY, [], (list) => { const i = list.findIndex((g) => g.file.k === file.k); const rec = { course: deck.course, file, unit, at: Date.now() }; if (i >= 0) list[i] = rec; else list.push(rec); return list; });
    nd.apply();
    const fi2 = C.data.files().findIndex((x) => x.k === file.k);
    if (C.slideText && fi2 >= 0) C.slideText[fi2] = t.pages;
    nd.list = nd.list.filter((d) => d.path !== deck.path);
    return unit;
  };

  // the page a new deck opens on, before its set exists
  nd.render = function (el, c, q) {
    const deck = nd.list.find((d) => d.path === q.path);
    if (!deck) { el.innerHTML = '<div class="state"><h3>That deck already has a set, or is gone</h3><p><a href="#/study/' + c.id + '">Back to ' + esc(c.code) + '</a></p></div>'; return; }
    el.innerHTML = '<header class="uhead"><div class="uhead__meta"><span class="ctag c-' + c.id + '">' + esc(c.code + ' ' + c.short) + '</span><span>new in the vault ' + esc(C.fmtShort(deck.modified)) + '</span></div><h1>' + esc(deck.file.replace(/\.pdf$/i, '')) + '</h1></header>' +
      '<div class="state"><h3>No study set yet</h3><p>Claude reads the slides and writes flashcards, about 16 questions, two written prompts, a summary and key points, each linked to its page. It takes a minute or two.</p>' +
      '<div class="qactions"><button class="btn btn--primary" type="button" id="buildDeck">' + C.icon.spark + ' Build the study set</button><span class="muted" id="buildStep" role="status"></span></div></div>';
    $('#buildDeck').onclick = async (e) => {
      if (!C.claude.available()) { C.toast('Claude is not connected. Start Carrel with Start Carrel.cmd, or add an API key in Settings.'); return; }
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const u = await nd.build(deck, (s) => ($('#buildStep').textContent = s));
        C.toast('Built ' + u.label + ': ' + u.quiz.length + ' questions, ' + u.cards.length + ' cards.');
        C.go('#/study/' + c.id + '/' + u.id + '/brief');
      } catch (err) { $('#buildStep').textContent = C.friendlyError ? C.friendlyError(err) : err.message; b.disabled = false; }
    };
  };

  C.on('boot', nd.apply);
  C.on('ready', async () => { nd.apply(); await nd.refresh(); if (nd.list.length && (C._lastView === 'study' || C._lastView === 'today')) C.render(); });
})();
