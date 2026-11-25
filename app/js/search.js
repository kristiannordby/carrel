/* Search everything: questions, flashcards, topics, deadlines, tasks and slide text. Opens with "/" or Ctrl+K. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  let index = null;

  function build() {
    const out = [];
    C.data.courses().forEach((c) => c.units.forEach((u) => {
      u.quiz.forEach((q, i) => out.push({ kind: 'Question', t: q.q, sub: c.code + ' ' + u.label, go: () => openQuiz(c.id, u.id, q), hay: (q.q + ' ' + q.o.join(' ')).toLowerCase() }));
      const notes = C.store.get('notes', {});
      u.quiz.forEach((q) => { const n = notes[C.study.qkey(c.id, u.id, q)]; if (n) out.push({ kind: 'Your note', t: n, sub: c.code + ' ' + u.label + ': ' + q.q.slice(0, 60), go: () => openQuiz(c.id, u.id, q), hay: (n + ' ' + q.q).toLowerCase() }); });
      u.cards.forEach((x, i) => out.push({ kind: 'Card', t: x.f, sub: c.code + ' ' + u.label, go: () => C.go('#/study/' + c.id + '/' + u.id + '/cards?i=' + (i + 1)), hay: (x.f + ' ' + x.b).toLowerCase() }));
      u.topics.forEach((x, i) => out.push({ kind: 'Topic', t: x.n, sub: c.code + ' ' + u.label + ' ' + u.title, go: () => C.go('#/study/' + c.id + '/' + u.id + '/brief'), hay: (x.n + ' ' + (x.x || '')).toLowerCase() }));
      out.push({ kind: 'Lecture', t: u.label + ' ' + u.title, sub: c.code, go: () => C.go('#/study/' + c.id + '/' + u.id), hay: (u.label + ' ' + u.title + ' ' + u.src).toLowerCase() });
    }));
    if (C.notes) C.notes.all().forEach((n) => out.push({ kind: 'Your notes', t: n.title, sub: C.data.courseName(n.course) + ', ' + n.kind.toLowerCase(), go: () => C.notes.open(n.path), hay: (n.title + ' ' + n.kind + ' ' + n.labels.join(' ') + ' ' + C.data.courseName(n.course)).toLowerCase() }));
    C.deadlines().forEach((d) => out.push({ kind: 'Deadline', t: d.title, sub: C.data.courseName(d.course) + ', ' + C.fmtShort(d.date), go: () => C.go('#/calendar/' + d.date.slice(0, 7)), hay: (d.title + ' ' + (d.notes || '') + ' ' + C.data.courseName(d.course)).toLowerCase() }));
    return out;
  }
  function openQuiz(cid, uid, q) {
    // start a one-question session on that exact question
    const u = C.data.unit(cid, uid);
    const i = u.quiz.indexOf(q);
    const k = 'sess:' + cid + ':' + uid;
    const s = C.store.get(k);
    if (s && s.items && s.filt === '||') {
      const pos = s.items.findIndex((x) => x.i === i && x.u === uid);
      if (pos >= 0) { s.cur = pos; C.store.set(k, s); C.go('#/study/' + cid + '/' + uid + '/quiz?i=' + (pos + 1)); return; }
    }
    C.store.set(k, { filt: '||', items: [{ u: uid, i, o: q.o.map((_, j) => j), pick: null }].concat(u.quiz.map((_, j) => j).filter((j) => j !== i).map((j) => ({ u: uid, i: j, o: u.quiz[j].o.map((_, z) => z), pick: null }))), cur: 0, started: Date.now() });
    C.go('#/study/' + cid + '/' + uid + '/quiz');
  }

  async function slideHits(qs, limit) {
    const text = await C.loadSlideText();
    const files = C.data.files();
    const hits = [];
    files.forEach((f, fi) => (text[fi] || []).forEach((pg, p) => {
      const low = pg.toLowerCase();
      if (qs.every((w) => low.includes(w))) hits.push({ kind: 'Slide', t: snippet(pg, qs[0]), sub: C.data.courseName(f.c) + ' ' + C.fileShort(f) + ' p.' + (p + 1), go: () => C.slides.open(fi, p + 1, { from: 'search' }) });
    }));
    return hits.slice(0, limit);
  }
  function snippet(s, w) { const i = s.toLowerCase().indexOf(w); const a = Math.max(0, i - 50); return (a ? '…' : '') + s.slice(a, a + 140).replace(/\s+/g, ' '); }
  function mark(s, qs) {
    if (!qs.length) return esc(s);
    const re = new RegExp('(' + qs.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return s.split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
  }

  function actions() {
    const out = [];
    const go = (h) => () => C.go(h);
    [['Today', '#/today'], ['Study', '#/study'], ['Grades', '#/grades'], ['Calendar, month', '#/calendar/' + C.today().slice(0, 7)], ['Calendar, week', '#/calendar/week/' + C.today()], ['Tasks', '#/tasks'], ['Recovery', '#/recovery']]
      .forEach(([n, h]) => out.push({ kind: 'Go to', t: n, sub: '', go: go(h) }));
    C.data.courses().filter((c) => c.units.length).forEach((c) => {
      out.push({ kind: 'Study', t: 'Review queue, ' + c.short, sub: c.code + ', ' + C.study.dueCount(c.id) + ' due', go: go('#/study/' + c.id + '/due/quiz') });
      out.push({ kind: 'Study', t: 'Exam drill, ' + c.short, sub: c.code, go: go('#/study/' + c.id + '/exam/quiz') });
      out.push({ kind: 'Study', t: 'Mock exam, ' + c.short, sub: c.code, go: go('#/study/' + c.id + '/mock') });
      out.push({ kind: 'Study', t: 'Topic mastery, ' + c.short, sub: c.code, go: go('#/study/' + c.id + '/map') });
    });
    out.push({ kind: 'Do', t: 'New task', sub: 'opens Tasks with the box focused', go: () => { C.go('#/tasks'); setTimeout(() => { const i = document.querySelector('#taskMount input[name="title"]'); i && i.focus(); }, 60); } });
    out.push({ kind: 'Do', t: 'Start a 25 minute focus block', sub: '', go: () => C.focus.start(25) });
    out.push({ kind: 'Do', t: 'Ask Claude', sub: 'opens the chat', go: () => { C.drawer.open('chat'); C.chat.focus(); } });
    out.push({ kind: 'Do', t: 'Switch day and night', sub: '', go: () => { C.store.update('settings', {}, (s) => { const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); s.theme = dark ? 'light' : 'dark'; }); C.applyTheme(); } });
    out.push({ kind: 'Do', t: 'Keyboard shortcuts', sub: '?', go: () => C.keysheet() });
    return out.map((a) => Object.assign(a, { hay: (a.kind + ' ' + a.t + ' ' + a.sub).toLowerCase() }));
  }

  C.search = function () {
    const dlg = $('#search');
    dlg.innerHTML = '<h2 id="searchTitle" class="visually-hidden">Search</h2><div class="searchbox"><svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg><label class="visually-hidden" for="sq">Search</label><input id="sq" type="search" role="combobox" aria-controls="sres" aria-expanded="false" aria-autocomplete="list" placeholder="Search questions, cards, slides, your notes" autocomplete="off"><kbd>Esc</kbd></div><div class="results" id="sres" role="listbox" aria-label="Results"></div><p class="visually-hidden" id="sCount" role="status"></p>';
    dlg.showModal();
    index = build();
    let sel = 0, items = [], tok = 0;
    const draw = () => {
      const q = $('#sq');
      q.setAttribute('aria-expanded', String(!!items.length));
      if (items.length) q.setAttribute('aria-activedescendant', 'sr-' + sel); else q.removeAttribute('aria-activedescendant');
      $('#sCount').textContent = q.value.trim().length < 2 ? '' : items.length ? items.length + ' results' : 'No matches';
      $('#sres').innerHTML = items.length ? items.map((r, i) => '<button class="result" type="button" role="option" tabindex="-1" id="sr-' + i + '" aria-selected="' + (i === sel) + '" data-i="' + i + '"><span class="result__t">' + mark(r.t.slice(0, 220), r.qs) + '</span><span class="result__m"><span>' + r.kind + '</span><span>' + esc(r.sub) + '</span></span></button>').join('') : '<div class="state"><p>' + ($('#sq').value.trim().length < 2 ? 'Type two letters or more. Slides and your notes are searched too.' : 'No matches.') + '</p></div>';
      $$('.result', dlg).forEach((b) => (b.onclick = () => { dlg.close(); items[+b.dataset.i].go(); }));
      const cur = $('#sr-' + sel);
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    };
    const run = async () => {
      const v = $('#sq').value.trim().toLowerCase();
      const qs = v.split(/\s+/).filter((w) => w.length > 1);
      const my = ++tok;
      if (!qs.length) { items = actions().slice(0, 12).map((r) => Object.assign({ qs: [] }, r)); sel = 0; draw(); return; }
      const acts = actions().filter((r) => qs.every((w) => r.hay.includes(w))).slice(0, 5);
      items = acts.concat(index.filter((r) => qs.every((w) => r.hay.includes(w))).slice(0, 40)).map((r) => Object.assign({ qs }, r));
      sel = 0; draw();
      const [nh, sh] = await Promise.all([C.notes ? C.notes.search(qs, 10) : [], slideHits(qs, 15)]);
      if (my !== tok) return;
      const mine = nh.map((h) => ({ kind: 'In your notes', t: h.snip, sub: h.n.title + (h.head ? ': ' + h.head : ''), go: () => C.notes.open(h.n.path, qs.join(' '), h.head) }));
      // your notes right after the first few exact matches, slides last
      const head = acts.length + 8;
      items = items.slice(0, head).concat(mine.slice(0, 6), items.slice(head), mine.slice(6), sh).map((r) => Object.assign({ qs }, r));
      draw();
    };
    let t;
    $('#sq').oninput = () => { clearTimeout(t); t = setTimeout(run, 120); };
    run();
    $('#sq').onkeydown = (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && items[sel]) { dlg.close(); items[sel].go(); }
    };
    draw();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }, { once: true });
  };
  C.on('vault', () => (index = null));
})();
