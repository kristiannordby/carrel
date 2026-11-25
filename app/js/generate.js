/* "Write more questions": Claude reads a lecture's slides and writes new multiple-choice questions in the deck's format.
   They are kept in this browser (and the local server), merged into the lecture set, marked as yours, and removable. */
(function () {
  'use strict';
  const C = window.C;
  const gen = (C.generate = {});
  const KEY = 'genq';

  // fold saved questions into the loaded decks; safe to call repeatedly
  gen.apply = function () {
    const all = C.store.get(KEY, {});
    C.data.courses().forEach((c) => c.units.forEach((u) => {
      u.quiz = u.quiz.filter((q) => !q.mine);
      const files = C.data.files();
      (all[c.id + ':' + u.id] || []).forEach((q) => {
        const x = Object.assign({ mine: true }, q);
        if (x.sk) { const fi = files.findIndex((f) => f.k === x.sk); x.s = fi >= 0 ? [fi, Math.min(x.sp || 1, files[fi].n)] : null; }
        u.quiz.push(x);
      });
    }));
  };
  gen.remove = function (cid, uid, q) {
    C.store.update(KEY, {}, (all) => { const k = cid + ':' + uid; all[k] = (all[k] || []).filter((x) => x.q !== q.q); all._t = Date.now(); });
    gen.apply();
  };

  async function slideContext(u, cap) {
    const text = await C.loadSlideText();
    const files = C.data.files();
    const out = [];
    let used = 0;
    (u.files || []).forEach((fi) => (text[fi] || []).forEach((pg, i) => {
      if (used > cap || !pg || pg.length < 40) return;
      const chunk = '[' + files[fi].f + ' p.' + (i + 1) + ']\n' + pg.slice(0, 1400);
      used += chunk.length;
      out.push(chunk);
    }));
    return out.join('\n\n');
  }

  gen.write = async function (cid, u, n, onProgress) {
    const slides = await slideContext(u, 42000);
    const examples = u.quiz.filter((q) => !q.mine).slice(0, 3).map((q) => JSON.stringify({ q: q.q, o: [q.o[q.a]].concat(q.o.filter((_, i) => i !== q.a)), e: q.e, d: q.d, t: q.t }));
    const stems = u.quiz.map((q) => '- ' + q.q.slice(0, 90)).slice(0, 60).join('\n');
    const prompt = '<context>\nCourse: ' + C.data.course(cid).code + ' ' + C.data.course(cid).name + '\nLecture set: ' + u.label + ' ' + u.title +
      '\nTopics (index: name): ' + u.topics.map((t, i) => i + ': ' + t.n).join('; ') +
      '\n\nSlide text, each page tagged [file p.N]:\n' + slides + '\n\nExisting questions (do not repeat these):\n' + stems + '\n</context>\n\n' +
      'Write ' + n + ' new exam-style multiple-choice questions on this lecture, grounded in the slides. Mix difficulty (about 2 easy, 4 medium, 2 hard per 8), and include at least two that need a small calculation or reasoning about a formulation. ' +
      'Each has exactly 4 options with the correct one FIRST, plausible distractors of similar length, and an explanation of why the answer is right and why the most tempting distractor is wrong. Use the deck\'s notation. ' +
      'Return ONLY a JSON array, no prose, no code fence. Each element: {"q": string, "o": [correct, wrong, wrong, wrong], "e": string, "d": "easy"|"medium"|"hard", "t": topic index, "ref": "<file> p.<page>"}.\nStyle examples:\n' + examples.join('\n');
    const raw = await C.claude.stream({ messages: [{ role: 'user', content: prompt }], onText: (full) => onProgress && onProgress((full.match(/"q"\s*:/g) || []).length) });
    const a = raw.indexOf('['), b = raw.lastIndexOf(']');
    if (a < 0 || b < a) throw new Error('Claude did not return questions in the expected format. Try again.');
    let arr;
    try { arr = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error('Could not read the questions Claude wrote (bad JSON). Try again.'); }
    const files = C.data.files();
    const clean = arr.filter((x) => x && typeof x.q === 'string' && Array.isArray(x.o) && x.o.length >= 3 && x.o.every((o) => typeof o === 'string')).map((x) => {
      let s = null;
      const m = String(x.ref || '').match(/^(.+?\.pdf)\s*p\.?\s*(\d+)/i);
      if (m) { const fi = files.findIndex((f) => f.f.toLowerCase() === m[1].trim().toLowerCase()); if (fi >= 0) s = [fi, Math.min(+m[2], files[fi].n)]; }
      return { q: x.q, o: x.o.slice(0, 5), a: 0, e: typeof x.e === 'string' ? x.e : '', d: ['easy', 'medium', 'hard'].includes(x.d) ? x.d : 'medium', t: Number.isInteger(x.t) && x.t >= 0 && x.t < u.topics.length ? x.t : 0, sk: s ? files[s[0]].k : null, sp: s ? s[1] : null, src: 'written by Claude ' + C.today(), by: 'claude' };
    });
    if (!clean.length) throw new Error('Claude returned no usable questions. Try again.');
    C.store.update(KEY, {}, (all) => { const k = cid + ':' + u.id; all[k] = (all[k] || []).concat(clean); all._t = Date.now(); });
    gen.apply();
    return clean.length;
  };

  // a lecture summary in the Midterm Studio's style: what it is, the key points, what an exam asks
  gen.brief = async function (cid, u) {
    const slides = await slideContext(u, 45000);
    const course = C.data.course(cid);
    const prompt = '<context>\nCourse: ' + course.code + ' ' + course.name + '\nLecture set: ' + u.label + ' ' + u.title + '\nTopics: ' + u.topics.map((t) => t.n).join('; ') + '\n\nSlide text, each page tagged [file p.N]:\n' + slides + '\n</context>\n\n' +
      'Write an exam-review brief of this lecture from the slides. Format: one paragraph (4 to 6 sentences) on what the lecture covers and why it matters; then a "Key points" list of 8 to 10 one-line items with the formulas and results worth memorising (LaTeX in $...$); then one line starting "Exam angle:" on what a midterm is likely to ask. Cite pages as (p.N) where useful. No preamble.';
    const text = await C.claude.stream({ messages: [{ role: 'user', content: prompt }] });
    if (!text || text.length < 80) throw new Error('Claude returned an empty brief. Try again.');
    return text.trim();
  };

  C.on('boot', gen.apply);
  C.on('ready', gen.apply);
})();
