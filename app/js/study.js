/* Study: course rail, lecture sets, quiz runner (question numbers open their slide), flashcards, written practice, briefs. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const L = 'ABCDEFGH';
  const study = (C.study = {});

  // ------------------------------------------------------------ helpers
  C.fileShort = function (f) {
    if (!f) return '';
    const n = f.f.replace(/\.pdf$/i, '');
    let m = n.match(/C57[-_]L(?:ec)?(\d+)/i) || n.match(/^Lec(?:ture)?[-_ ]?0?(\d+)/i) || n.match(/^Lecture(\d+)_presentation/i);
    if (m) return 'L' + m[1] + (/12a/.test(n) ? 'a' : '');
    m = n.match(/rec(?:itation)?[ _-]?(\d+)/i);
    if (m) return 'Rec ' + m[1];
    if (/practice-exam/i.test(n)) return 'Practice exam';
    if (/C57-5$/.test(n)) return 'L5';
    return n.replace(/_/g, ' ').replace(/(POSTCLASS|PostClass|Post-Class|PreClass|Pre-Class|Preclass|InClass)[-_ ]*/g, '').replace(/\s*2026.*$/, '').replace(/RM\s*/g, '').slice(0, 24).trim();
  };
  // a weak text match is labelled "near", so the link never claims more precision than it has
  C.slideLabel = (s) => { if (!s) return ''; const f = C.data.files()[s[0]]; return f ? C.fileShort(f) + (s.length > 2 && s[2] < 0.1 ? ' near p.' : ' p.') + s[1] : ''; };
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const qkey = (cid, uid, q) => cid + ':' + uid + ':q' + C.hash(q.q);
  const ckey = (cid, uid, c) => cid + ':' + uid + ':c' + C.hash(c.f);
  const wkey = (cid, uid, w) => cid + ':' + uid + ':w' + C.hash(w.q);
  study.qkey = qkey;

  // ------------------------------------------------------------ progress
  const prog = () => C.store.get('progress', {});
  // Leitner boxes: a right answer moves an item up a box and pushes its next review out; a miss sends it to box 0.
  // A right answer marked "guessing" never climbs past box 1, so it comes back tomorrow.
  const INTERVALS = [0, 1, 3, 7, 16, 35];
  study.INTERVALS = INTERVALS;
  function record(key, right, guessed) {
    let prev = null;
    C.store.update('progress', {}, (p) => {
      prev = p[key] ? Object.assign({}, p[key]) : null;
      const e = Object.assign({ r: 0, w: 0, box: 0 }, p[key]);
      if (right) { e.r++; e.box = guessed ? Math.min(1, e.box + 1) : Math.min(5, e.box + 1); } else { e.w++; e.box = 0; }
      e.last = right ? 1 : 0;
      e.g = guessed ? 1 : 0;
      e.at = Date.now();
      e.due = C.addDays(C.today(), INTERVALS[e.box]);
      p[key] = e;
      p._t = Date.now();
    });
    C.store.update('activity', {}, (a) => { const d = C.today(); a[d] = (a[d] || 0) + 1; a._t = Date.now(); });
    C.store.update('calib', {}, (c) => { const k = (guessed ? 'g' : 's') + (right ? 'r' : 'w'); c[k] = (c[k] || 0) + 1; c._t = Date.now(); });
    // [date, course, right] per answer, for the accuracy trend; capped
    C.store.update('answerLog', [], (l) => { l.push([C.today(), key.split(':')[0], right ? 1 : 0, Date.now()]); if (l.length > 6000) l.splice(0, l.length - 6000); return l; });
    return prev;
  }
  function unrecord(key, prev, right, guessed) {
    // an undo is newer than the answer it removes, so the other device's copy of that answer does not come back
    C.store.update('progress', {}, (p) => {
      if (prev) p[key] = Object.assign({}, prev, { at: Date.now() });
      else { delete p[key]; p._gone = Object.assign({}, p._gone, { [key]: Date.now() }); }
      p._t = Date.now();
    });
    C.store.update('activity', {}, (a) => { const d = C.today(); a[d] = Math.max(0, (a[d] || 1) - 1); a._t = Date.now(); });
    C.store.update('calib', {}, (c) => { const k = (guessed ? 'g' : 's') + (right ? 'r' : 'w'); c[k] = Math.max(0, (c[k] || 1) - 1); c._t = Date.now(); });
    C.store.update('answerLog', [], (l) => { for (let i = l.length - 1; i >= 0; i--) if (l[i][1] === key.split(':')[0] && l[i][0] === C.today()) { l.splice(i, 1); break; } return l; });
  }
  study.isDue = (e, t) => e && (e.due ? e.due <= t : e.last === 0);
  study.dueCount = function (cid) {
    const p = prog(), t = C.today();
    let n = 0;
    const c = C.data.course(cid);
    if (!c || !c.units) return 0;
    c.units.forEach((u) => u.quiz.forEach((q) => { if (study.isDue(p[qkey(cid, u.id, q)], t)) n++; }));
    return n;
  };
  study.note = (key) => (C.store.get('notes', {})[key] || '');
  study.unitMastery = function (cid, u) {
    const p = prog();
    let seen = 0, right = 0;
    u.quiz.forEach((q) => { const e = p[qkey(cid, u.id, q)]; if (e) { seen++; if (e.last === 1) right++; } });
    return { seen, right, total: u.quiz.length, pct: u.quiz.length ? right / u.quiz.length : 0 };
  };
  study.courseMastery = function (cid, unitIds) {
    const c = C.data.course(cid);
    if (!c || !c.units) return null;
    let seen = 0, right = 0, total = 0;
    c.units.filter((u) => !unitIds || unitIds.includes(u.id)).forEach((u) => { const m = study.unitMastery(cid, u); seen += m.seen; right += m.right; total += m.total; });
    return { seen, right, total, pct: total ? right / total : 0 };
  };
  study.masterySummary = function () {
    return C.data.courses().filter((c) => c.units.length).map((c) => c.code + ': ' + c.units.map((u) => { const m = study.unitMastery(c.id, u); return u.label + ' ' + (m.seen ? Math.round(m.pct * 100) + '%' : 'not started'); }).join(', ')).join('\n');
  };
  // units an exam covers: "Covers through Lecture 12" limits by lecture number, otherwise the whole course
  study.examUnits = function (deadline) {
    const c = C.data.course(deadline.course);
    if (!c || !c.units || !c.units.length) return [];
    const m = (deadline.notes || '').match(/through Lecture (\d+)/i);
    let lo = 0, hi = 99;
    if (m) {
      hi = +m[1];
      const prev = C.deadlines().filter((d) => d.course === deadline.course && d.kind === 'exam' && d.date < deadline.date).map((d) => (d.notes || '').match(/through Lecture (\d+)/i)).filter(Boolean);
      if (prev.length) lo = +prev[prev.length - 1][1];
    }
    return c.units.filter((u) => {
      const n = (u.label.match(/^L(\d+)/) || [])[1];
      if (n) return +n > lo && +n <= hi;
      if (u.label === 'PE') return lo === 0;
      const r = (u.label.match(/^R(\d+)/) || [])[1];
      return r ? lo === 0 || hi === 99 : hi === 99 || lo === 0;
    }).map((u) => u.id);
  };

  // ------------------------------------------------------------ lookup for highlight context
  study.lookup = function (ref) {
    const u = C.data.unit(ref.c, ref.u);
    if (!u) return {};
    const list = ref.k === 'quiz' ? u.quiz : ref.k === 'card' ? u.cards : ref.k === 'written' ? u.written : u.topics;
    const item = list[ref.i];
    const out = { item, kind: ref.k === 'topic' ? 'topic' : ref.k };
    if (ref.k === 'quiz' && ref.order) { out.order = ref.order; out.picked = ref.picked; }
    return out;
  };

  // ------------------------------------------------------------ flags
  // flagging a question flags its topic too; a topic stays flagged while any of its questions is
  study.flags = () => (C.store.get('flags', {}) || {}).q || {};
  study.toggleFlag = function (cid, u, item) {
    const key = qkey(cid, u.id, item);
    C.store.update('flags', {}, (f) => {
      f.q = f.q || {};
      if (f.q[key]) delete f.q[key];
      else f.q[key] = { c: cid, u: u.id, t: item.t == null ? 0 : item.t, at: Date.now() };
      f._t = Date.now();
    });
    return !!study.flags()[key];
  };
  study.topicFlagged = (cid, uid, t) => Object.values(study.flags()).some((x) => x.c === cid && x.u === uid && x.t === (t == null ? 0 : t));
  study.flagCount = (cid) => itemsFor(cid, 'flag', {}).length;

  // ------------------------------------------------------------ session state per set
  function sessKey(cid, uid) { return 'sess:' + cid + ':' + uid; }
  function itemsFor(cid, uid, q) {
    // returns [{u, i, q}] for a set; special sets build across units
    const c = C.data.course(cid);
    if (!c) return [];
    const all = [];
    c.units.forEach((u) => u.quiz.forEach((x, i) => all.push({ u, i, q: x })));
    if (uid === 'flag') {
      const f = study.flags();
      return all.filter((it) => f[qkey(cid, it.u.id, it.q)]);
    }
    if (uid === 'weak') {
      const p = prog();
      return all.filter((it) => { const e = p[qkey(cid, it.u.id, it.q)]; return e && e.last === 0; });
    }
    if (uid === 'due') {
      const p = prog(), t = C.today();
      return all.map((it) => [p[qkey(cid, it.u.id, it.q)], it]).filter(([e]) => study.isDue(e, t))
        .sort((a, b) => (a[0].box || 0) - (b[0].box || 0) || (a[0].due || '').localeCompare(b[0].due || '')).slice(0, 40).map((x) => x[1]);
    }
    if (uid === 'exam') {
      const units = (q.units || '').split(',').filter(Boolean);
      const pool = all.filter((it) => !units.length || units.includes(it.u.id));
      const p = prog();
      // missed and unseen first, then the rest; 25 questions
      const score = (it) => { const e = p[qkey(cid, it.u.id, it.q)]; return e ? (e.last === 0 ? 0 : 2 + Math.random()) : 1 + Math.random(); };
      return pool.map((it) => [score(it), it]).sort((a, b) => a[0] - b[0]).slice(0, +(q.n || 25)).map((x) => x[1]);
    }
    const u = c.units.find((x) => x.id === uid);
    if (!u) return [];
    return u.quiz.map((x, i) => ({ u, i, q: x })).filter((it) => (q.t == null || q.t === '' || String(it.q.t) === String(q.t)) && (!q.d || it.q.d === q.d));
  }
  // re-point stored items at the current deck by question key; drop any whose question is gone
  study.resolve = function (cid, items) {
    const maps = {};
    const out = [];
    (items || []).forEach((x) => {
      const u = C.data.unit(cid, x.u);
      if (!u) return;
      if (!maps[u.id]) { maps[u.id] = {}; u.quiz.forEach((qq, i) => (maps[u.id][qkey(cid, u.id, qq)] = i)); }
      const i = x.k != null ? maps[u.id][x.k] : (u.quiz[x.i] ? x.i : undefined);
      if (i == null) return;
      const qq = u.quiz[i];
      x.i = i;
      x.k = qkey(cid, u.id, qq);
      if (!Array.isArray(x.o) || x.o.length !== qq.o.length) x.o = qq.o.map((_, k) => k);
      out.push(x);
    });
    return out;
  };
  study.item = (cid, uid, q, i, r) => ({ u: uid, i, k: qkey(cid, uid, q), o: shuffle(q.o.map((_, k) => k), r || Math.random), pick: null });
  function getSession(cid, uid, q, fresh) {
    const filt = [q.t || '', q.d || '', q.units || ''].join('|');
    let s = C.store.get(sessKey(cid, uid));
    if (!fresh && s && s.filt === filt && s.items && s.items.length) {
      const before = s.items.length;
      s.items = study.resolve(cid, s.items);
      // questions flagged since the list was made join the end; unflagged ones stay until a restart, so nothing jumps
      if (uid === 'flag') {
        const have = new Set(s.items.map((x) => x.k));
        itemsFor(cid, 'flag', q).filter((it) => !have.has(qkey(cid, it.u.id, it.q))).forEach((it) => s.items.push(study.item(cid, it.u.id, it.q, it.i)));
        if (s.items.length !== before) C.store.set(sessKey(cid, uid), s);
      }
      if (s.items.length) {
        if (s.items.length !== before) { s.cur = Math.min(s.cur || 0, s.items.length - 1); C.store.set(sessKey(cid, uid), s); }
        return s;
      }
    }
    const items = itemsFor(cid, uid, q);
    const r = rng(Date.now() % 100000);
    const ordered = C.settings().shuffle === false && uid !== 'exam' ? items : shuffle(items, r);
    s = {
      filt,
      items: ordered.map((it) => study.item(cid, it.u.id, it.q, it.i, r)),
      cur: 0,
      started: Date.now(),
    };
    C.store.set(sessKey(cid, uid), s);
    return s;
  }
  function saveSession(cid, uid, s) { C.store.set(sessKey(cid, uid), s); }

  // ------------------------------------------------------------ view
  C.routes.study = {
    title: 'Study',
    render(main, r) {
      study.keys = null;
      clearInterval(study._clock);
      const courses = C.data.courses().filter((c) => (c.units && c.units.length) || (C.newdecks && C.newdecks.forCourse(c.id).length));
      const last = C.store.get('lastStudy', {});
      const has = (id) => courses.some((x) => x.id === id);
      const cid = r.parts[0] && has(r.parts[0]) ? r.parts[0] : last.c && has(last.c) ? last.c : courses[0].id;
      const c = C.data.course(cid);
      if (!c.units.length) {
        // a course with lecture PDFs but no study set yet (a new course): open its first deck, ready to build one
        const deck = C.newdecks.forCourse(cid).find((d) => d.path === (r.q && r.q.path)) || C.newdecks.forCourse(cid)[0];
        if (r.parts[1] !== 'new' || !(r.q && r.q.path)) return C.go('#/study/' + cid + '/new?path=' + encodeURIComponent(deck.path), true);
      }
      let uid = r.parts[1] || (last.c === cid && last.u) || c.units[0].id;
      if (!['weak', 'flag', 'exam', 'due', 'mock', 'map', 'new'].includes(uid) && !c.units.find((u) => u.id === uid)) uid = c.units[0].id;
      const mode = r.parts[2] || (['weak', 'flag', 'exam', 'due', 'mock', 'map', 'new'].includes(uid) ? 'quiz' : last.m || 'quiz');
      if (uid !== 'new') C.store.set('lastStudy', { c: cid, u: uid, m: mode });
      if (!r.parts[1]) C.go('#/study/' + cid + '/' + uid + '/' + mode + (location.hash.split('?')[1] ? '?' + location.hash.split('?')[1] : ''), true);

      let page = $('.page.study-page', main);
      if (!page) {
        main.innerHTML = '<div class="page study-page"><div class="study"><nav class="rail" id="rail" aria-label="Lecture sets"></nav><div class="study__main"><button class="iconbtn rail__show" type="button" data-railshow aria-label="Show sidebar" title="Show sidebar  (Ctrl B)">' + C.icon.sidebar + '</button><div id="studyMain"></div></div></div></div>';
        page = $('.page.study-page', main);
      }
      $('.study', page).classList.toggle('is-railless', study.railHidden());
      renderRail(courses, cid, uid);
      const sm = $('#studyMain');
      C.mhead(railLabel(c, uid));
      if (['weak', 'flag', 'exam', 'due', 'mock', 'map', 'new'].includes(uid)) renderSpecial(sm, c, uid, r.q);
      else renderUnit(sm, c, c.units.find((u) => u.id === uid), mode, r.q);
      phoneChrome();
    },
  };

  // what the course switcher calls each course
  const ABBR = { c57: 'OM', '095': 'ML Opt', '072': 'AAE', faa: 'FAA', alab: 'A-Lab', hodl: 'HODL' };

  // hide the lecture-set rail while studying (button or Ctrl+B); remembered between visits
  study.railHidden = () => !!C.store.get('railHidden', false);
  study.toggleRail = function () {
    const page = $('.study');
    if (!page) return;
    const hide = !study.railHidden();
    C.store.set('railHidden', hide);
    page.classList.toggle('is-railless', hide);
    const back = $(hide ? '[data-railshow]' : '[data-railhide]');
    if (back) back.focus({ preventScroll: true });
  };
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-railhide], [data-railshow]')) study.toggleRail(); });
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'b' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && C._lastView === 'study' && $('.study') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      study.toggleRail();
    }
  });

  // phones: the mode tabs and filters live in the study-options panel (the rail, slid in from the right),
  // and the module title gets the button that opens it
  const PHONE = window.matchMedia('(max-width: 40rem)');
  const FUNNEL = '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M3.5 4.5h13l-5 6.2v4.8l-3 1.5v-6.3z"/></svg>';
  function phoneChrome() {
    const slot = $('#railModes'), mb = $('#studyMain .modebar');
    if (PHONE.matches && slot && mb) slot.appendChild(mb);
    const h1 = $('#studyMain .uhead h1');
    if (h1 && !h1.parentElement.classList.contains('uhead__row')) {
      const row = document.createElement('div');
      row.className = 'uhead__row';
      h1.replaceWith(row);
      row.appendChild(h1);
      row.insertAdjacentHTML('beforeend', '<button class="iconbtn fbtn" type="button" data-fpanel aria-controls="rail" aria-label="Study options: course, set, mode and filters">' + FUNNEL + '</button>');
    }
  }
  // crossing the phone width redraws, so the mode tabs go back to their place (or into the panel)
  const onWidth = () => { if (C._lastView === 'study') { if (study.setRailOpen) study.setRailOpen(false); C.render(); } };
  if (PHONE.addEventListener) PHONE.addEventListener('change', onWidth); else if (PHONE.addListener) PHONE.addListener(onWidth); // older Safari
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-fpanel], [data-mflag], #railModes [data-mode]');
    if (!t) return;
    if (t.hasAttribute('data-fpanel')) { if (study.setRailOpen) study.setRailOpen(true); return; }
    if (t.hasAttribute('data-mflag')) { const f = $('#qFlag'); if (f) f.click(); return; }
    if (study.setRailOpen) study.setRailOpen(false); // a mode tab in the panel: go there and close it
  });

  // what the phone's lecture-set button says: the set you are in
  function railLabel(c, uid) {
    const special = { due: 'Review queue', exam: 'Exam drill', map: 'Topic mastery', mock: 'Mock exam', weak: 'Missed questions', flag: 'Flagged questions', new: 'New in the vault' }[uid];
    if (special) return special;
    const u = c.units.find((x) => x.id === uid);
    return u ? u.label + ' ' + (u.short || u.title) : 'Lecture sets';
  }

  function renderRail(courses, cid, uid) {
    const c = C.data.course(cid);
    const weakN = itemsFor(cid, 'weak', {}).length;
    const rail = $('#rail');
    rail.innerHTML =
      '<div class="rail__sheethead"><b>Study options</b><button class="iconbtn" type="button" data-railclose aria-label="Close study options">' + C.icon.x + '</button></div>' +
      '<div class="rail__courses"><div class="seg" role="group" aria-label="Course">' +
      courses.map((x) => '<button type="button" aria-pressed="' + (x.id === cid) + '" data-c="' + x.id + '" title="' + esc(x.code + ' ' + x.name) + '">' + esc(ABBR[x.id] || x.code) + '</button>').join('') +
      '</div><button class="iconbtn rail__hide" type="button" data-railhide aria-label="Hide sidebar" title="Hide sidebar  (Ctrl B)">' + C.icon.sidebar + '</button></div>' +
      '<button class="btn rail__toggle" type="button" id="railToggle" aria-expanded="false" aria-controls="railList">' + C.icon.menu + '<span class="rail__cur">' + esc(railLabel(c, uid)) + '</span><span class="rail__chev" aria-hidden="true">' + C.icon.right + '</span></button>' +
      '<div class="rail__scrim" aria-hidden="true"></div>' +
      '<div class="rail__modes" id="railModes"></div>' +
      '<div class="rail__list" id="railList">' +
      '<div class="rail__group rail__group--phone">Review and practice</div>' +
      '<div class="rail__special">' +
      '<a href="#/study/' + cid + '/due/quiz" aria-current="' + (uid === 'due') + '"><span class="lab">Due</span><span>Review queue</span><span class="pct">' + (study.dueCount(cid) || '') + '</span></a>' +
      '<a href="#/study/' + cid + '/exam/quiz" aria-current="' + (uid === 'exam') + '"><span class="lab">Mix</span><span>Exam drill</span><span class="pct"></span></a>' +
      '<a href="#/study/' + cid + '/map" aria-current="' + (uid === 'map') + '"><span class="lab">Map</span><span>Topic mastery</span><span class="pct"></span></a>' +
      '<a href="#/study/' + cid + '/mock" aria-current="' + (uid === 'mock') + '"><span class="lab">Timed</span><span>Mock exam</span><span class="pct">' + ((C.store.get('mock:' + cid) || {}).state === 'live' ? 'live' : '') + '</span></a>' +
      '<a href="#/study/' + cid + '/weak/quiz" aria-current="' + (uid === 'weak') + '"><span class="lab">Redo</span><span>Missed questions</span><span class="pct">' + (weakN || '') + '</span></a>' +
      '<a href="#/study/' + cid + '/flag/quiz" aria-current="' + (uid === 'flag') + '"><span class="lab">Flag</span><span>Flagged questions</span><span class="pct">' + (study.flagCount(cid) || '') + '</span></a>' +
      '</div>' +
      (C.newdecks && C.newdecks.forCourse(cid).length ? '<div class="rail__group">New in the vault</div>' + C.newdecks.forCourse(cid).map((d) => '<a href="#/study/' + cid + '/new?path=' + encodeURIComponent(d.path) + '" aria-current="' + (uid === 'new' && C.route.q.path === d.path) + '"><span class="lab">' + esc(C.fileShort({ f: d.file })) + '</span><span>' + esc(d.file.replace(/\.pdf$/i, '')) + '</span><span class="new">build</span></a>').join('') + '<div class="rail__group">Lecture sets</div>' : '') +
      c.units.map((u) => {
        const m = study.unitMastery(cid, u);
        return '<a href="#/study/' + cid + '/' + u.id + '" aria-current="' + (u.id === uid) + '" title="' + esc(u.title) + '"><span class="lab">' + esc(u.label) + '</span><span>' + esc(u.short || u.title) + (u.new ? ' <span class="new">new</span>' : '') + '</span><span class="pct' + (m.pct >= 0.8 ? ' is-strong' : '') + '">' + (m.seen ? Math.round(m.pct * 100) + '%' : '') + '</span></a>';
      }).join('') +
      '</div>';
    $$('[data-c]', rail).forEach((b) => (b.onclick = () => { setOpen(false); C.go('#/study/' + b.dataset.c); }));
    // on a phone the list is a sheet over the page; the current set scrolls into view when it opens
    const setOpen = (open) => {
      rail.classList.toggle('is-open', open);
      $('#railToggle').setAttribute('aria-expanded', String(open));
      document.documentElement.classList.toggle('sheet-open', open);
      // scroll only the list (scrollIntoView would also move the page behind the sheet)
      const list = $('.rail__list', rail), cur = $('.rail__list a[aria-current="true"]', rail);
      if (open && cur) list.scrollTop = Math.max(0, cur.offsetTop - list.clientHeight / 2);
    };
    $('#railToggle').onclick = () => setOpen(!rail.classList.contains('is-open'));
    $$('[data-railclose], .rail__scrim', rail).forEach((b) => (b.onclick = () => { setOpen(false); $('#railToggle').focus({ preventScroll: true }); }));
    $$('.rail__list a', rail).forEach((a) => a.addEventListener('click', () => setOpen(false)));
    rail.onkeydown = (e) => { if (e.key === 'Escape' && rail.classList.contains('is-open')) { e.stopPropagation(); setOpen(false); $('#railToggle').focus(); } };
    study.setRailOpen = setOpen;
    document.documentElement.classList.toggle('sheet-open', rail.classList.contains('is-open'));
  }

  // ------------------------------------------------------------ a lecture set
  function renderUnit(el, c, u, mode, q) {
    const m = study.unitMastery(c.id, u);
    const modes = [['quiz', 'Quiz', u.quiz.length], ['cards', 'Flashcards', u.cards.length], ['written', 'Written', u.written.length], ['brief', 'Brief', null]].filter((x) => x[2] !== 0);
    if (!modes.find((x) => x[0] === mode)) mode = modes[0][0];
    const head =
      '<header class="uhead" data-ctx="' + C.ctxAttr({ course: c.id, unit: u.id, kind: 'unit', label: u.label + ' ' + u.title }) + '">' +
      '<div class="uhead__meta"><span class="ctag c-' + c.id + '">' + esc(c.code + ' ' + c.short) + '</span><span>' + esc(u.label) + '</span>' +
      (m.seen ? '<span>' + m.right + ' of ' + m.total + ' right on last try</span>' : '<span>' + u.quiz.length + ' questions, ' + u.cards.length + ' cards</span>') + '</div>' +
      '<h1>' + esc(u.title) + '</h1>' +
      (u.src && mode === 'brief' ? '<p class="uhead__src">' + esc(u.src.replace(/\s·\s/g, ', ')) + '</p>' : '') +
      '</header>' +
      '<div class="modebar"><div class="seg" role="tablist" aria-label="Study mode">' +
      modes.map(([k, lab, n]) => '<button type="button" role="tab" aria-selected="' + (k === mode) + '" data-mode="' + k + '">' + lab + (n ? ' <span class="muted">' + n + '</span>' : '') + '</button>').join('') +
      '</div><div class="filters" id="filters"></div></div>' +
      '<div id="modeBody"></div>';
    el.innerHTML = head;
    $$('[data-mode]', el).forEach((b) => (b.onclick = () => C.go('#/study/' + c.id + '/' + u.id + '/' + b.dataset.mode)));
    const body = $('#modeBody');
    if (mode === 'quiz') renderQuiz(body, c, u.id, q, u);
    if (mode === 'cards') renderCards(body, c, u, q);
    if (mode === 'written') renderWritten(body, c, u, q);
    if (mode === 'brief') renderBrief(body, c, u);
  }

  function renderSpecial(el, c, uid, q) {
    if (uid === 'exam') {
      const exams = C.deadlines().filter((d) => d.course === c.id && d.kind === 'exam' && d.date >= C.today());
      const next = exams[0];
      if (!q.units && next) { q.units = study.examUnits(next).join(','); C.setQuery({ units: q.units }); }
      const chosen = (q.units || '').split(',').filter((id) => c.units.some((u) => u.id === id));
      q.units = chosen.join(',');
      el.innerHTML =
        '<header class="uhead"><div class="uhead__meta"><span class="ctag c-' + c.id + '">' + esc(c.code + ' ' + c.short) + '</span>' +
        (next ? '<span>' + esc(next.title) + ' ' + esc(C.fmtShort(next.date)) + ', ' + C.rel(next.date) + '</span>' : '') + '</div>' +
        '<h1>Exam drill</h1><p class="uhead__src">25 questions across the lectures below, missed and unseen ones first.</p></header>' +
        '<div class="modebar"><div class="filters" role="group" aria-label="Lectures in the drill">' +
        c.units.map((u) => '<button class="chip" type="button" data-u="' + u.id + '" aria-pressed="' + (!chosen.length || chosen.includes(u.id)) + '" title="' + esc(u.title) + '">' + esc(u.label) + '</button>').join('') +
        '</div><div class="qactions"><a class="btn btn--sm btn--quiet" href="#/sheet/' + c.id + (q.units ? '?units=' + encodeURIComponent(q.units) : '') + '">' + C.icon.print + ' Review sheet</a><button class="btn btn--sm" type="button" id="newDrill">' + C.icon.shuffle + ' New drill</button></div></div><div id="modeBody"></div>';
      $$('[data-u]', el).forEach((b) => (b.onclick = () => {
        const cur = chosen.length ? chosen.slice() : c.units.map((u) => u.id);
        const i = cur.indexOf(b.dataset.u);
        if (i >= 0) cur.splice(i, 1); else cur.push(b.dataset.u);
        C.setQuery({ units: cur.join(',') });
        C.store.set(sessKey(c.id, 'exam'), null);
        C.render();
      }));
      $('#newDrill').onclick = () => { C.store.set(sessKey(c.id, 'exam'), null); C.render(); };
      renderQuiz($('#modeBody'), c, 'exam', q, null);
      return;
    }
    if (uid === 'mock') return renderMock(el, c, q);
    if (uid === 'map') return renderMap(el, c);
    if (uid === 'new') return C.newdecks.render(el, c, q);
    const head = uid === 'due'
      ? ['Review queue', 'Questions whose review date has come up, weakest box first. Right answers push the next review out to 1, 3, 7, 16, then 35 days; a miss brings it back today.']
      : uid === 'flag'
        ? ['Flagged questions', 'Questions you flagged, and with them their topics (marked in Topic mastery). Unflag one and it leaves this list the next time you open it.']
        : ['Missed questions', 'Every question you got wrong on its last try. Get it right and it leaves this list.'];
    el.innerHTML = '<header class="uhead"><div class="uhead__meta"><span class="ctag c-' + c.id + '">' + esc(c.code + ' ' + c.short) + '</span></div><h1>' + head[0] + '</h1><p class="uhead__src">' + head[1] + '</p></header><div id="modeBody"></div>';
    renderQuiz($('#modeBody'), c, uid, q, null);
  }

  // ------------------------------------------------------------ quiz
  function renderQuiz(el, c, uid, q, unit) {
    const filters = $('#filters');
    if (unit && filters) {
      const diffs = ['easy', 'medium', 'hard'].filter((d) => unit.quiz.some((x) => x.d === d));
      filters.innerHTML =
        (unit.topics.length > 1 ? '<label class="visually-hidden" for="topicSel">Topic</label><select id="topicSel"><option value="">All topics</option>' + unit.topics.map((t, i) => { const n = unit.quiz.filter((x) => x.t === i).length; return n ? '<option value="' + i + '"' + (String(q.t) === String(i) ? ' selected' : '') + '>' + esc(t.n) + ' (' + n + ')' + (study.topicFlagged(c.id, unit.id, i) ? ', flagged' : '') + '</option>' : ''; }).join('') + '</select>' : '') +
        (diffs.length > 1 ? diffs.map((d) => '<button class="chip" type="button" data-d="' + d + '" aria-pressed="' + (q.d === d) + '">' + d + '</button>').join('') : '') +
        '<span class="sep" aria-hidden="true"></span><button class="iconbtn" type="button" id="restart" aria-label="Restart with a new shuffle" title="Restart with a new shuffle">' + C.icon.shuffle + '</button>' +
        '<button class="btn btn--sm btn--quiet" type="button" id="writeMore" title="Claude reads this lecture\u2019s slides and writes 8 new questions">' + C.icon.spark + ' Write 8 more</button>';
      const ts = $('#topicSel');
      if (ts) ts.onchange = () => { C.setQuery({ t: ts.value, i: '' }); C.render(); };
      $$('[data-d]', filters).forEach((b) => (b.onclick = () => { C.setQuery({ d: q.d === b.dataset.d ? '' : b.dataset.d }); C.render(); }));
      $('#restart').onclick = () => { getSession(c.id, uid, q, true); C.render(); };
      $('#writeMore').onclick = async (e) => {
        const b = e.currentTarget;
        if (!C.claude.available()) { C.toast('Claude is not connected. Start Carrel with Start Carrel.cmd, or add an API key in Settings.'); return; }
        b.disabled = true;
        b.textContent = 'Claude is reading the slides\u2026';
        try {
          const n = await C.generate.write(c.id, unit, 8, (k) => { if (k) b.textContent = 'Writing question ' + Math.min(k, 8) + ' of 8\u2026'; });
          getSession(c.id, uid, q, true);
          C.render();
          C.toast(n + ' new questions added to ' + unit.label + '. They are marked "yours" and can be removed.');
        } catch (err) { C.toast(err.message); b.disabled = false; b.innerHTML = C.icon.spark + ' Write 8 more'; }
      };
    }
    const s = getSession(c.id, uid, q, false);
    if (!s.items.length) {
      const special = { weak: ['Nothing to redo', 'Questions you miss land here until you answer them right.'], flag: ['Nothing flagged', 'Click the flag beside a question number (or press M) to flag the question and its topic. They collect here.'], due: ['Nothing due today', 'Answered questions come back here on their review date. Start a lecture set or an exam drill to fill the queue.'] }[uid];
      el.innerHTML = '<div class="state"><h3>' + (special ? special[0] : 'No questions match') + '</h3><p>' + (special ? special[1] : 'Clear the topic or difficulty filter to see the full set.') + '</p>' + (special ? '<a class="btn" href="#/study/' + c.id + '/exam/quiz">Run an exam drill</a>' : '') + '</div>';
      return;
    }
    s.cur = Math.min(s.cur || 0, s.items.length - 1);
    const done = s.items.filter((x) => x.pick != null);
    const allDone = done.length === s.items.length;
    if (allDone && s.showSummary !== false && s.cur === s.items.length - 1 && s.summary) return renderSummary(el, c, uid, s, q);
    const it = s.items[s.cur];
    const u = C.data.unit(c.id, it.u);
    const item = u.quiz[it.i];
    const answered = it.pick != null;
    const right = answered && it.pick === item.a;
    const slide = item.s;
    const topic = u.topics[item.t];
    const label = (uid === 'weak' || uid === 'exam' ? u.label + ' ' : u.label + ' ') + 'Q' + (s.cur + 1);
    const key = qkey(c.id, u.id, item);
    const ctx = { course: c.id, unit: u.id, kind: 'quiz', label, noteKey: key, ref: { c: c.id, u: u.id, k: 'quiz', i: it.i, order: it.o, picked: it.pick } };
    const hist = prog()[key];
    const note = study.note(key);
    const flags = study.flags();
    const flagged = !!flags[key];
    const topicFlag = study.topicFlagged(c.id, u.id, item.t);
    el.innerHTML =
      '<div class="qwrap">' +
      '<nav class="qnav" aria-label="Questions">' + s.items.map((x, k) => {
        const uu = C.data.unit(c.id, x.u), qq = uu.quiz[x.i];
        const cls = (x.pick == null ? '' : x.pick === qq.a ? ' is-right' : ' is-wrong') + (flags[x.k] ? ' is-flag' : '');
        return '<button class="navnum' + cls + '" type="button" data-k="' + k + '" aria-current="' + (k === s.cur) + '" aria-label="Question ' + (k + 1) + (x.pick == null ? '' : x.pick === qq.a ? ', right' : ', wrong') + (flags[x.k] ? ', flagged' : '') + '">' + (k + 1) + '</button>';
      }).join('') + '</nav>' +
      '<article class="q" data-ctx="' + C.ctxAttr(ctx) + '" data-swipe="#qNext, #qSum|#qPrev">' +
      '<div class="q__meta">' +
      (slide ? '<button class="qnum" type="button" id="qSlide" title="Open the lecture slide for this question (S)">' + C.icon.slide + '<span>Q' + (s.cur + 1) + '</span><span class="qnum__where">' + esc(C.slideLabel(slide)) + '</span></button>' : '<span class="qnum">Q' + (s.cur + 1) + '</span>') +
      (uid !== u.id ? '<a href="#/study/' + c.id + '/' + u.id + '" class="ctag c-' + c.id + '">' + esc(u.label + ' ' + (u.short || u.title)) + '</a>' : '') +
      '<button class="iconbtn qflag" type="button" id="qFlag" aria-pressed="' + flagged + '" aria-label="' + (flagged ? 'Unflag this question' : 'Flag this question and its topic') + '" title="' + (flagged ? 'Flagged, with its topic. Click to unflag (M)' : 'Flag this question and its topic (M)') + '">' + C.icon.flag + '</button>' +
      (topic && u.topics.length > 1 ? '<span class="qtopic' + (topicFlag ? ' is-flag" title="Flagged topic' : '') + '">' + (topicFlag ? C.icon.flag : '') + esc(topic.n) + '</span>' : '') +
      (['easy', 'medium', 'hard'].includes(item.d) ? '<span class="diff diff--' + item.d + '">' + item.d + '</span>' : '') +
      (item.mine ? '<span class="muted">written by Claude</span><button class="linkbtn muted" type="button" id="qRemove">remove</button>' : '') +
      (hist && !answered ? '<span class="muted">' + (hist.last === 0 ? 'missed last time' : 'right last time') + '</span>' : '') +
      (answered && hist && hist.due ? '<span class="muted">next review ' + esc(hist.due === C.today() ? 'today' : C.fmtShort(hist.due)) + '</span>' : '') +
      (!answered ? '<button class="chip push" type="button" id="qGuess" aria-pressed="' + !!it.g + '" title="Mark before answering if you are not sure (G)">I’m guessing</button>' : it.g ? '<span class="chip push" aria-hidden="true">guessed</span>' : '') +
      '</div>' +
      '<p class="q__text">' + C.inline(item.q) + '</p>' +
      '<div class="opts" role="group" aria-label="Answers">' + it.o.map((oi, pos) => {
        let cls = '', mark = '';
        if (answered) {
          if (oi === item.a) { cls = ' is-correct'; mark = 'Right answer'; }
          else if (oi === it.pick) { cls = ' is-wrong'; mark = 'Your pick'; }
          else cls = ' is-dim';
        }
        return '<button class="opt' + cls + '" type="button" data-o="' + oi + '"' + (answered ? ' disabled' : '') + '><span class="let">' + L[pos] + '</span><span>' + C.inline(item.o[oi]) + '</span><span class="mark">' + mark + '</span></button>';
      }).join('') + '</div>' +
      (answered ? '<div class="expl"><span class="expl__verdict ' + (right ? 'is-right' : 'is-wrong') + '">' + (right ? (it.g ? 'Right, but a guess: it comes back tomorrow.' : 'Right.') : 'Not this time. It is in Missed questions now.') + ' <button class="linkbtn muted" type="button" id="qUndo">Undo</button></span>' + (item.e ? '<p>' + C.inline(item.e) + '</p>' : '') + '</div>' : '') +
      '<details class="note"' + (note ? ' open' : '') + '><summary>' + (note ? 'Your note' : 'Add a note') + '</summary><label class="visually-hidden" for="qNote">Your note on this question</label><textarea id="qNote" rows="2" placeholder="Why you missed it, the trick, a reminder. Claude sees this too.">' + esc(note) + '</textarea></details>' +
      '<div class="qactions">' +
      '<button class="btn btn--sm" type="button" id="qExplain">' + C.icon.spark + ' Explain concept</button>' +
      '<button class="btn btn--sm" type="button" id="qAsk">' + C.icon.chat + ' Ask Claude</button>' +
      (slide ? '<button class="btn btn--sm btn--quiet" type="button" id="qSlide2">Open slide ' + esc(C.slideLabel(slide)) + '</button>' : '') +
      (answered && C.notes ? C.notes.best(c.id, u, 2).map((n) => '<button class="btn btn--sm btn--quiet" type="button" data-note="' + esc(n.path) + '" data-find="' + esc((item.q.replace(/\n/g, ' ') + '\n' + (item.e || '')).slice(0, 500)) + '">In your ' + esc(n.title) + '</button>').join('') : '') +
      '</div>' +
      '</article>' +
      '<div class="qfoot"><button class="btn" type="button" id="qPrev"' + (s.cur === 0 ? ' disabled' : '') + '>' + C.icon.left + ' Previous</button>' +
      '<span class="hint">' + done.length + ' of ' + s.items.length + ' answered, ' + done.filter((x) => { const uu = C.data.unit(c.id, x.u); return x.pick === uu.quiz[x.i].a; }).length + ' right. Keys: <kbd>1</kbd> to <kbd>4</kbd> answer, <kbd>G</kbd> guessing, <kbd>S</kbd> slide, <kbd>E</kbd> explain</span>' +
      (allDone && s.cur === s.items.length - 1 ? '<button class="btn btn--primary" type="button" id="qSum">See results</button>' : '<button class="btn' + (answered ? ' btn--primary' : '') + '" type="button" id="qNext"' + (s.cur === s.items.length - 1 ? ' disabled' : '') + '>Next ' + C.icon.right + '</button>') +
      '</div></div>';
    C.renderMath(el);
    // phones: the question's topic in the header's centre, its flag at the top right
    C.mhead(topic ? topic.n : u.label + ' ' + (u.short || u.title), '<button class="iconbtn mflag" type="button" data-mflag aria-pressed="' + flagged + '" aria-label="' + (flagged ? 'Unflag this question' : 'Flag this question and its topic') + '">' + C.icon.flag + '</button>');
    const go = (k) => { s.cur = Math.max(0, Math.min(s.items.length - 1, k)); saveSession(c.id, uid, s); C.setQuery({ i: s.cur + 1 }); renderQuiz(el, c, uid, q, unit); $('.q__text', el) && el.querySelector('.qnav').scrollIntoView({ block: 'nearest' }); };
    $$('.navnum', el).forEach((b) => (b.onclick = () => go(+b.dataset.k)));
    $$('.opt', el).forEach((b) => (b.onclick = () => {
      if (it.pick != null) return;
      it.pick = +b.dataset.o;
      it.prev = record(key, it.pick === item.a, !!it.g);
      C.announce(it.pick === item.a ? 'Right.' : 'Not right. The answer is ' + item.o[item.a]);
      if (s.items.every((x) => x.pick != null)) s.summary = true;
      saveSession(c.id, uid, s);
      renderQuiz(el, c, uid, q, unit);
      renderRail(C.data.courses().filter((x) => x.units.length), c.id, uid);
      const nb = $('#qNext') || $('#qSum');
      nb && nb.focus({ preventScroll: true });
    }));
    if ($('#qRemove')) $('#qRemove').onclick = () => { C.generate.remove(c.id, u.id, item); getSession(c.id, uid, q, true); C.render(); C.toast('Question removed.'); };
    $('#qFlag').onclick = () => {
      const on = study.toggleFlag(c.id, u, item);
      const tName = topic ? topic.n : u.title;
      C.toast(on ? 'Flagged this question and ' + tName + '.' : 'Unflagged.' + (study.topicFlagged(c.id, u.id, item.t) ? ' ' + tName + ' stays flagged for its other flagged questions.' : ''));
      const pct = $('#rail a[href$="/flag/quiz"] .pct');
      if (pct) pct.textContent = study.flagCount(c.id) || '';
      renderQuiz(el, c, uid, q, unit);
      const fb = $('#qFlag'); if (fb) fb.focus({ preventScroll: true });
    };
    if ($('#qGuess')) $('#qGuess').onclick = () => { it.g = !it.g; saveSession(c.id, uid, s); $('#qGuess').setAttribute('aria-pressed', String(!!it.g)); };
    if ($('#qUndo')) $('#qUndo').onclick = () => {
      unrecord(key, it.prev || null, it.pick === item.a, !!it.g);
      it.pick = null; it.prev = null; s.summary = false;
      saveSession(c.id, uid, s);
      renderQuiz(el, c, uid, q, unit);
      renderRail(C.data.courses().filter((x) => x.units.length), c.id, uid);
    };
    let nt;
    $('#qNote').oninput = (e) => { clearTimeout(nt); nt = setTimeout(() => C.store.update('notes', {}, (m) => { const v = e.target.value.trim(); if (v) m[key] = v; else delete m[key]; m._t = Date.now(); }), 300); };
    const openSlide = () => slide && C.slides.open(slide[0], slide[1], { from: label });
    if ($('#qSlide')) $('#qSlide').onclick = openSlide;
    if ($('#qSlide2')) $('#qSlide2').onclick = openSlide;
    const fullCtx = () => Object.assign({}, ctx, study.lookup(ctx.ref), { picked: it.pick });
    $('#qExplain').onclick = (e) => C.explain(Object.assign(fullCtx(), { label }), e.currentTarget);
    $('#qAsk').onclick = () => C.chat.open({ ctx: fullCtx(), label, prompt: answered ? (right ? 'I got this right. Make sure I understand why, then give me a harder variant.' : 'I got this wrong. Explain where my reasoning went off and why the right answer is right.') : null, send: answered });
    $('#qPrev').onclick = () => go(s.cur - 1);
    if ($('#qNext')) $('#qNext').onclick = () => go(s.cur + 1);
    if ($('#qSum')) $('#qSum').onclick = () => { s.summary = true; s.cur = s.items.length - 1; saveSession(c.id, uid, s); renderSummary(el, c, uid, s, q); };
    study.keys = (e) => {
      const k = e.key.toLowerCase();
      if (/^[1-6]$/.test(k)) {
        const pos = +k - 1;
        const b = $$('.opt', el)[pos];
        if (b && !b.disabled) { b.click(); return true; }
      }
      if (k === 'arrowright' || k === 'n' || (k === 'enter' && answered)) { const nb = $('#qNext') || $('#qSum'); if (nb && !nb.disabled) { nb.click(); return true; } }
      if (k === 'arrowleft' || k === 'p') { $('#qPrev').click(); return true; }
      if (k === 's') { openSlide(); return true; }
      if (k === 'e') { $('#qExplain').click(); return true; }
      if (k === 'g' && $('#qGuess')) { $('#qGuess').click(); return true; }
      if (k === 'u' && $('#qUndo')) { $('#qUndo').click(); return true; }
      if (k === 'm') { $('#qFlag').click(); return true; }
      if (k === 'f' && slide) { if (!(C.drawer.isOpen() && C.drawer.pane === 'slides')) openSlide(); setTimeout(() => C.slides.fullscreen(), 400); return true; }
      return false;
    };
  }

  function renderSummary(el, c, uid, s, q) {
    const rows = s.items.map((x) => { const u = C.data.unit(c.id, x.u); return { x, u, item: u.quiz[x.i] }; });
    const right = rows.filter((r) => r.x.pick === r.item.a);
    const by = (d) => { const a = rows.filter((r) => (r.item.d || 'medium') === d); return a.length ? right.filter((r) => (r.item.d || 'medium') === d).length + ' of ' + a.length : null; };
    const missed = rows.filter((r) => r.x.pick !== r.item.a);
    const topics = {};
    missed.forEach((r) => { const t = r.u.topics[r.item.t]; const k = r.u.label + ' ' + (t ? t.n : r.u.title); topics[k] = (topics[k] || 0) + 1; });
    const mins = Math.max(1, Math.round((Date.now() - s.started) / 60000));
    C.store.update('history', [], (h) => { if (!s.logged) { h.push({ at: Date.now(), c: c.id, u: uid, n: rows.length, r: right.length }); s.logged = true; saveSession(c.id, uid, s); } return h.slice(-400); });
    el.innerHTML =
      '<div class="summary">' +
      '<div><div class="summary__fig">' + right.length + ' of ' + rows.length + '</div><p class="muted">right, in about ' + mins + ' min</p></div>' +
      '<dl class="stats">' + ['easy', 'medium', 'hard'].map((d) => by(d) ? '<div><dt>' + d + '</dt><dd>' + by(d) + '</dd></div>' : '').join('') +
      (rows.some((r) => r.x.g) ? '<div><dt>when sure</dt><dd>' + rows.filter((r) => !r.x.g && r.x.pick === r.item.a).length + ' of ' + rows.filter((r) => !r.x.g).length + '</dd></div><div><dt>when guessing</dt><dd>' + rows.filter((r) => r.x.g && r.x.pick === r.item.a).length + ' of ' + rows.filter((r) => r.x.g).length + '</dd></div>' : '') + '</dl>' +
      (missed.length ? '<div class="topics">' + Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([k, n]) => '<div class="topic"><h3>' + esc(k) + '</h3><div class="topic__body"><p>' + n + ' missed</p></div></div>').join('') + '</div>' : '<p>Clean sweep. Nothing added to Missed questions.</p>') +
      '<div class="qactions">' +
      (missed.length ? '<button class="btn btn--primary" type="button" id="sumRetry">Retry the ' + missed.length + ' missed</button><button class="btn" type="button" id="sumClaude">' + C.icon.chat + ' Ask Claude about my misses</button>' : '') +
      '<button class="btn" type="button" id="sumAgain">' + C.icon.shuffle + ' New round</button>' +
      (uid === 'due' ? (function () { const n = C.data.courses().filter((x) => x.id !== c.id && x.units.length && C.study.dueCount(x.id)); return n.length ? '<a class="btn btn--primary" href="#/study/' + n[0].id + '/due/quiz">Next: ' + esc(n[0].code) + ' review (' + C.study.dueCount(n[0].id) + ')</a>' : ''; })() : '') +
      '<button class="btn btn--quiet" type="button" id="sumReview">Review answers</button></div></div>';
    if ($('#sumRetry')) $('#sumRetry').onclick = () => {
      const r = rng(Date.now() % 9999);
      const ns = { filt: s.filt, items: shuffle(missed.map((m) => study.item(c.id, m.x.u, m.item, m.x.i, r)), r), cur: 0, started: Date.now() };
      saveSession(c.id, uid, ns);
      C.render();
    };
    if ($('#sumClaude')) $('#sumClaude').onclick = () => {
      const list = missed.map((m, k) => (k + 1) + '. [' + m.u.label + '] ' + m.item.q + '\n   My answer: ' + m.item.o[m.x.pick] + '\n   Right answer: ' + m.item.o[m.item.a]).join('\n');
      C.chat.open({ ctx: null, label: 'Misses from ' + (uid === 'exam' ? 'the exam drill' : uid === 'weak' ? 'missed questions' : C.data.unit(c.id, uid).label), prompt: 'I just finished a ' + c.code + ' quiz and missed these. Find the pattern in my mistakes, explain the 2 or 3 underlying ideas I am shaky on, then give me one fresh question per idea.\n\n' + list });
    };
    $('#sumAgain').onclick = () => { getSession(c.id, uid, q, true); C.render(); };
    $('#sumReview').onclick = () => { s.summary = false; s.cur = 0; saveSession(c.id, uid, s); C.render(); };
    study.keys = null;
  }

  // ------------------------------------------------------------ flashcards
  function renderCards(el, c, u, q) {
    const filters = $('#filters');
    const marks = C.store.get('cards', {});
    const only = q.only || '';
    const pr = prog(), today = C.today();
    const cardDue = (x) => { const e = pr[ckey(c.id, u.id, x)]; return e && e.due && e.due <= today; };
    const noBook = C.store.get('noBook', false);
    let list = u.cards.map((x, i) => ({ x, i })).filter(({ x }) => (only !== 'learning' || marks[ckey(c.id, u.id, x)] !== 'k') && (only !== 'due' || cardDue(x)) && !(noBook && x.bk));
    if (q.t != null && q.t !== '') list = list.filter(({ x }) => String(x.t) === String(q.t));
    if (filters) {
      const learning = u.cards.filter((x) => marks[ckey(c.id, u.id, x)] !== 'k').length;
      filters.innerHTML = (u.topics.length > 1 ? '<label class="visually-hidden" for="topicSel2">Topic</label><select id="topicSel2"><option value="">All topics</option>' + u.topics.map((t, i) => { const n = u.cards.filter((x) => x.t === i).length; return n ? '<option value="' + i + '"' + (String(q.t) === String(i) ? ' selected' : '') + '>' + esc(t.n) + ' (' + n + ')</option>' : ''; }).join('') + '</select>' : '') +
        '<button class="chip" type="button" id="onlyL" aria-pressed="' + (only === 'learning') + '">Still learning ' + learning + '</button>' +
        '<button class="chip" type="button" id="onlyD" aria-pressed="' + (only === 'due') + '">Due today ' + u.cards.filter(cardDue).length + '</button>' +
        '<span class="sep" aria-hidden="true"></span><button class="btn btn--sm btn--quiet" type="button" id="toAnki" title="A tab-separated file Anki imports (File, Import)">Export to Anki</button>' +
        (u.cards.some((x) => x.bk) ? '<button class="chip" type="button" id="noBook" aria-pressed="' + noBook + '" title="Hide cards that come only from the textbook">Lecture cards only</button>' : '');
      if ($('#topicSel2')) $('#topicSel2').onchange = (e) => { C.setQuery({ t: e.target.value, i: '' }); C.render(); };
      $('#onlyL').onclick = () => { C.setQuery({ only: only === 'learning' ? '' : 'learning', i: '' }); C.render(); };
      $('#onlyD').onclick = () => { C.setQuery({ only: only === 'due' ? '' : 'due', i: '' }); C.render(); };
      $('#toAnki').onclick = () => {
        const cell = (x) => String(x || '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\$\$([\s\S]+?)\$\$/g, '\\[$1\\]').replace(/\$([^$]+?)\$/g, '\\($1\\)');
        const tag = (c.code + '::' + u.label).replace(/\s+/g, '_');
        const lines = ['#separator:tab', '#html:true', '#tags column:3'].concat(u.cards.map((x) => cell(x.f) + '\t' + cell(x.b) + (x.x ? '<br><br><i>' + cell(x.x) + '</i>' : '') + (x.s ? '<br><small>' + cell(C.slideLabel(x.s)) + '</small>' : '') + '\t' + tag));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }));
        a.download = c.code + ' ' + u.label + ' cards (Anki).txt';
        a.click();
        C.toast(u.cards.length + ' cards saved. In Anki: File, Import, pick the file.');
      };
      if ($('#noBook')) $('#noBook').onclick = () => { C.store.set('noBook', !noBook); C.setQuery({ i: '' }); C.render(); };
    }
    if (!list.length) { el.innerHTML = only === 'due' ? '<div class="state"><h3>No cards due</h3><p>Cards you mark come back on a schedule: "Know it" pushes a card out to 1, 3, 7, 16, then 35 days; "Still learning" brings it back today.</p></div>' : '<div class="state"><h3>Every card here is marked known</h3><p>Turn off "Still learning" to see the whole deck again.</p></div>'; return; }
    let i = Math.min(Math.max(0, (+q.i || 1) - 1), list.length - 1);
    let flipped = false;
    const draw = () => {
      const { x, i: idx } = list[i];
      const key = ckey(c.id, u.id, x);
      const mk = C.store.get('cards', {})[key];
      const ctx = { course: c.id, unit: u.id, kind: 'card', label: u.label + ' card ' + (idx + 1), noteKey: key, ref: { c: c.id, u: u.id, k: 'card', i: idx } };
      el.innerHTML =
        '<div class="wr">' +
        '<div class="card" id="card" role="region" aria-label="Flashcard ' + (idx + 1) + '" data-ctx="' + C.ctxAttr(ctx) + '" data-swipe="#cNext|#cPrev">' +
        '<div class="card__top">' + (x.s ? '<button class="qnum" type="button" id="cSlide" title="Open the slide for this card">' + C.icon.slide + '<span>' + (idx + 1) + '</span><span class="qnum__where">' + esc(C.slideLabel(x.s)) + '</span></button>' : '<span class="qnum">' + (idx + 1) + '</span>') +
        '<span class="muted">' + (mk === 'k' ? 'Known' : mk === 'l' ? 'Still learning' : '') + (x.bk ? ' Textbook' : '') + '</span></div>' +
        '<p class="card__face">' + C.inline(x.f) + '</p>' +
        (flipped ? '<div class="card__back"><p>' + C.inline(x.b) + '</p>' + (x.x ? '<p class="x">' + C.inline(x.x) + '</p>' : '') + '</div>' : '<p class="muted card__hint"><span class="onkeys">Space or click to flip</span><span class="ontouch">Tap to flip, swipe for the next card</span></p>') +
        '</div>' +
        '<div class="cardbar"><div class="qactions"><button class="btn" type="button" id="cPrev" aria-label="Previous card"' + (i === 0 ? ' disabled' : '') + '>' + C.icon.left + '</button><span class="muted">' + (i + 1) + ' of ' + list.length + '</span><button class="btn" type="button" id="cNext" aria-label="Next card"' + (i === list.length - 1 ? ' disabled' : '') + '>' + C.icon.right + '</button>' +
        '<button class="btn btn--sm" type="button" id="cFlip" aria-expanded="' + flipped + '">' + (flipped ? 'Hide answer' : 'Show answer') + ' <kbd>Space</kbd></button></div>' +
        '<div class="qactions"><button class="btn btn--sm" type="button" id="cLearn">Still learning <kbd>1</kbd></button><button class="btn btn--sm" type="button" id="cKnow">Know it <kbd>2</kbd></button>' +
        '<button class="btn btn--sm btn--quiet" type="button" id="cExplain">' + C.icon.spark + ' Explain</button></div></div></div>';
      C.renderMath(el);
      C.mhead(u.topics[x.t] && u.topics.length > 1 ? u.topics[x.t].n : u.label + ' flashcards');
      const flip = () => { flipped = !flipped; draw(); if (flipped) C.announce(x.b.replace(/[*$`]/g, '')); };
      $('#card').onclick = (e) => { if (!e.target.closest('button') && !window.getSelection().toString()) flip(); };
      $('#cFlip').onclick = () => { flip(); const b = $('#cFlip'); b && b.focus({ preventScroll: true }); };
      const move = (d) => { i = Math.max(0, Math.min(list.length - 1, i + d)); flipped = false; C.setQuery({ i: i + 1 }); draw(); };
      $('#cPrev').onclick = () => move(-1);
      $('#cNext').onclick = () => move(1);
      const mark = (v) => {
        C.store.update('cards', {}, (m) => { m[key] = v; m._t = Date.now(); });
        // the same Leitner schedule as questions: know it climbs a box, still learning drops to box 0
        C.store.update('progress', {}, (p) => {
          const e = Object.assign({ box: 0 }, p[key]);
          e.box = v === 'k' ? Math.min(5, e.box + 1) : 0;
          e.due = C.addDays(C.today(), INTERVALS[e.box]);
          e.at = Date.now();
          p[key] = e;
          p._t = Date.now();
        });
        C.store.update('activity', {}, (a) => { const d = C.today(); a[d] = (a[d] || 0) + 1; a._t = Date.now(); });
        const pNow = prog(), cm = C.store.get('cards', {});
        const dueChip = $('#onlyD'), learnChip = $('#onlyL');
        if (dueChip) dueChip.textContent = 'Due today ' + u.cards.filter((y) => { const e = pNow[ckey(c.id, u.id, y)]; return e && e.due && e.due <= C.today(); }).length;
        if (learnChip) learnChip.textContent = 'Still learning ' + u.cards.filter((y) => cm[ckey(c.id, u.id, y)] !== 'k').length;
        move(1);
      };
      $('#cLearn').onclick = () => mark('l');
      $('#cKnow').onclick = () => mark('k');
      if ($('#cSlide')) $('#cSlide').onclick = () => C.slides.open(x.s[0], x.s[1], { from: ctx.label });
      $('#cExplain').onclick = (e) => C.explain(Object.assign({}, ctx, study.lookup(ctx.ref)), e.currentTarget);
      study.keys = (e) => {
        if (e.key === 'ArrowRight') { move(1); return true; }
        if (e.key === 'ArrowLeft') { move(-1); return true; }
        if (e.key === ' ' && e.target === document.body) { flip(); return true; }
        if (e.key === '1') { mark('l'); return true; }
        if (e.key === '2') { mark('k'); return true; }
        if (e.key.toLowerCase() === 's' && x.s) { C.slides.open(x.s[0], x.s[1], { from: ctx.label }); return true; }
        return false;
      };
    };
    draw();
  }

  // ------------------------------------------------------------ written practice, graded by Claude
  // written problems copied from your notes run to several paragraphs, lists and tables: those render as markdown
  const richQ = (s) => (/\n/.test(s) ? '<div class="wr__q wr__q--long prose">' + C.md(s) + '</div>' : '<p class="wr__q">' + C.inline(s) + '</p>');
  const richA = (s) => (/\n/.test(s) ? '<div class="prose">' + C.md(s) + '</div>' : '<p>' + C.inline(s) + '</p>');

  // Claude grades a written answer against the model answer and rubric; the reply starts "Score: x / y"
  study.gradeWritten = async function (cid, u, i, ans, onText) {
    const w = u.written[i];
    const ctx = { course: cid, unit: u.id, kind: 'written', label: u.label + ' written ' + (i + 1), ref: { c: cid, u: u.id, k: 'written', i } };
    const block = await C.contextBlock(Object.assign({}, ctx, study.lookup(ctx.ref)));
    return C.claude.stream({
      messages: [{ role: 'user', content: '<context>\n' + block + '\n</context>\n\nMy answer:\n' + ans + '\n\nGrade my answer against the model answer and rubric' + (w.pts ? ' out of ' + w.pts + ' points' : '') + '. Start with a line "Score: x / y" (or "Verdict: ..." if there are no points). Then list what I got right, what is missing or wrong, and the one fix that would earn the most points. Be strict like an exam grader, and brief.' }],
      onText,
    });
  };
  // "Score: 7 / 10", "**Score: 7** / 10", "Score: 7.5/10", "Score: 7 out of 10"
  study.scoreOf = (fb) => { const m = /Score:\s*([\d.]+)\s*(?:\/|out of)\s*([\d.]+)/i.exec(String(fb || '').replace(/\*/g, '')); return m ? [+m[1], +m[2]] : null; };

  function renderWritten(el, c, u, q) {
    $('#filters').innerHTML = '';
    let i = Math.min(Math.max(0, (+q.i || 1) - 1), u.written.length - 1);
    const draw = () => {
      const w = u.written[i];
      const key = wkey(c.id, u.id, w);
      const saved = C.store.get('written', {})[key] || {};
      const ctx = { course: c.id, unit: u.id, kind: 'written', label: u.label + ' written ' + (i + 1), ref: { c: c.id, u: u.id, k: 'written', i } };
      el.innerHTML =
        '<div class="wr" data-ctx="' + C.ctxAttr(ctx) + '" data-swipe="#wNext|#wPrev">' +
        '<div class="q__meta">' + (w.s ? '<button class="qnum" type="button" id="wSlide">' + C.icon.slide + '<span>W' + (i + 1) + '</span><span class="qnum__where">' + esc(C.slideLabel(w.s)) + '</span></button>' : '<span class="qnum">W' + (i + 1) + '</span>') +
        (w.pts ? '<span>' + w.pts + ' points</span>' : '') + (w.src ? '<span>' + esc(w.src) + '</span>' : '') + '<span class="muted">' + (i + 1) + ' of ' + u.written.length + '</span></div>' +
        richQ(w.q) +
        '<label class="field">Your answer<textarea id="wAns" name="answer" placeholder="Write it the way you would on the exam: the formulation, the reasoning, the key steps.">' + esc(saved.a || '') + '</textarea></label>' +
        '<div class="qactions"><button class="btn btn--primary" type="button" id="wGrade">Grade with Claude</button><button class="btn" type="button" id="wShow">' + (saved.shown ? 'Hide' : 'Show') + ' model answer</button>' +
        '<span class="push"></span><button class="btn" type="button" id="wPrev" aria-label="Previous question"' + (i === 0 ? ' disabled' : '') + '>' + C.icon.left + '</button><button class="btn" type="button" id="wNext" aria-label="Next question"' + (i === u.written.length - 1 ? ' disabled' : '') + '>' + C.icon.right + '</button></div>' +
        '<div id="wFeedback" class="prose">' + (saved.fb ? C.md(saved.fb) : '') + '</div>' +
        (saved.shown ? '<div class="expl"><span class="expl__verdict">Model answer</span>' + richA(w.m) + (w.k && w.k.length ? '<ul class="rubric">' + w.k.map((k) => '<li>' + C.inline(k) + '</li>').join('') + '</ul>' : '') + (w.x ? '<p class="muted">' + C.inline(w.x) + '</p>' : '') + '</div>' : '') +
        '</div>';
      C.renderMath(el);
      const save = (patch) => C.store.update('written', {}, (m) => { m[key] = Object.assign(m[key] || {}, patch); m._t = Date.now(); });
      $('#wAns').oninput = (e) => save({ a: e.target.value });
      $('#wShow').onclick = () => { save({ shown: !saved.shown }); draw(); };
      $('#wPrev').onclick = () => { i--; C.setQuery({ i: i + 1 }); draw(); };
      $('#wNext').onclick = () => { i++; C.setQuery({ i: i + 1 }); draw(); };
      if ($('#wSlide')) $('#wSlide').onclick = () => C.slides.open(w.s[0], w.s[1], { from: ctx.label });
      $('#wGrade').onclick = async () => {
        const ans = $('#wAns').value.trim();
        if (!ans) { $('#wAns').setAttribute('aria-invalid', 'true'); $('#wAns').setAttribute('aria-describedby', 'wAnsErr'); if (!$('#wAnsErr')) $('#wAns').insertAdjacentHTML('afterend', '<span class="field__help msg__err" id="wAnsErr">Write an answer first, then Claude can grade it.</span>'); $('#wAns').focus(); return; }
        const btn = $('#wGrade');
        btn.classList.add('is-loading');
        const fb = $('#wFeedback');
        try {
          const full = await study.gradeWritten(c.id, u, i, ans, (t) => C.html(fb, C.md(t)));
          save({ fb: full });
        } catch (e) { fb.innerHTML = '<p class="msg__err">' + esc(C.friendlyError(e)) + '</p>'; }
        btn.classList.remove('is-loading');
      };
      study.keys = null;
    };
    draw();
  }

  // ------------------------------------------------------------ brief
  function renderBrief(el, c, u) {
    $('#filters').innerHTML = '';
    const files = (u.files || []).map((fi) => [fi, C.data.files()[fi]]).filter((x) => x[1]);
    const counts = u.topics.map((_, i) => u.quiz.filter((q) => q.t === i).length);
    el.innerHTML =
      '<div class="brief" data-ctx="' + C.ctxAttr({ course: c.id, unit: u.id, kind: 'unit', label: u.label + ' ' + u.title }) + '">' +
      (u.brief ? '<p class="brief__lead">' + C.inline(u.brief) + '</p>' : (C.store.get('briefs', {})[c.id + ':' + u.id] ? '' : '<div class="state"><h3>No summary for this lecture yet</h3><p>Claude can read its slides and write a summary with key points, kept here for next time.</p><button class="btn btn--primary" type="button" id="writeBrief">' + C.icon.spark + ' Write a brief with Claude</button></div>')) +
      (!u.brief && C.store.get('briefs', {})[c.id + ':' + u.id] ? '<div class="prose brief__lead">' + C.md(C.store.get('briefs', {})[c.id + ':' + u.id].text) + '<p class="muted">Written by Claude from the slides, ' + esc(C.fmtShort(C.store.get('briefs', {})[c.id + ':' + u.id].date)) + '. <button class="linkbtn muted" type="button" id="rewriteBrief">Rewrite</button></p></div>' : '') +
      (u.kp && u.kp.length ? '<section><h2>Key points</h2><ul class="kp">' + u.kp.map((k) => '<li>' + C.inline(k) + '</li>').join('') + '</ul></section>' : '') +
      (C.notes ? C.notes.section(c.id, u) : '') +
      '<section><h2>Topics</h2><div class="topics">' + u.topics.map((t, i) => {
        const ctx = { course: c.id, unit: u.id, kind: 'topic', label: u.label + ' ' + t.n, ref: { c: c.id, u: u.id, k: 'topic', i } };
        return '<div class="topic" data-ctx="' + C.ctxAttr(ctx) + '"><h3>' + esc(t.n) + '</h3><div class="topic__body">' + (t.x ? '<p>' + C.inline(t.x) + '</p>' : '') +
          '<div class="slidelinks">' + (t.sl || []).map((s) => '<button class="chip" type="button" data-sl="' + s[0] + ',' + s[1] + '" title="' + esc(s[2] || '') + '">' + esc(C.fileShort(C.data.files()[s[0]]) + ' p.' + s[1] + (s[2] ? ': ' + s[2] : '')) + '</button>').join('') + '</div>' +
          '<div class="qactions"><button class="btn btn--sm" type="button" data-explain="' + i + '">' + C.icon.spark + ' Explain concept</button>' +
          '<button class="btn btn--sm" type="button" data-teach="' + i + '">' + C.icon.chat + ' Explain it back</button>' +
          (counts[i] ? '<a class="btn btn--sm btn--quiet" href="#/study/' + c.id + '/' + u.id + '/quiz?t=' + i + '">Quiz this topic (' + counts[i] + ')</a>' : '') + '</div></div></div>';
      }).join('') + '</div></section>' +
      '<section class="noprint"><h2>Your progress here</h2><p class="muted">Clears this lecture\u2019s answers, review dates, card marks and quiz session. Notes stay.</p><p><button class="btn btn--sm" type="button" id="resetUnit">Reset ' + esc(u.label) + ' progress</button></p></section>' +
      (files.length ? '<section><h2>Lecture decks</h2><div class="decks">' + files.map(([fi, f]) => '<div class="deckrow"><span>' + esc(f.f.replace(/\.pdf$/i, '')) + ' <span class="muted">' + f.n + ' pages</span></span><button class="btn btn--sm" type="button" data-sl="' + fi + ',1">Open in the panel</button><a class="btn btn--sm btn--primary" href="#/walk/' + fi + '">Walk through the slides</a></div>').join('') + '</div></section>' : '') +
      '</div>';
    C.renderMath(el);
    $$('[data-sl]', el).forEach((b) => (b.onclick = () => { const [fi, p] = b.dataset.sl.split(',').map(Number); C.slides.open(fi, p, { from: u.label }); }));
    const writeBrief = async (b) => {
      if (!C.claude.available()) { C.toast('Claude is not connected. Start Carrel with Start Carrel.cmd, or add an API key in Settings.'); return; }
      b.disabled = true;
      b.textContent = 'Claude is reading the slides\u2026';
      try {
        const text = await C.generate.brief(c.id, u);
        C.store.update('briefs', {}, (m) => { m[c.id + ':' + u.id] = { text, date: C.today() }; m._t = Date.now(); });
        renderBrief(el, c, u);
      } catch (e) { C.toast(e.message); b.disabled = false; b.textContent = 'Write a brief with Claude'; }
    };
    if ($('#writeBrief')) $('#writeBrief').onclick = (e) => writeBrief(e.currentTarget);
    if ($('#rewriteBrief')) $('#rewriteBrief').onclick = (e) => writeBrief(e.currentTarget);
    $('#resetUnit').onclick = () => {
      const before = { progress: JSON.parse(JSON.stringify(prog())), cards: JSON.parse(JSON.stringify(C.store.get('cards', {}))), sess: C.store.get(sessKey(c.id, u.id)) };
      const prefix = c.id + ':' + u.id + ':';
      // cleared answers leave a marker so another device's copy does not bring them back
      C.store.update('progress', {}, (p) => { const now = Date.now(); p._gone = Object.assign({}, p._gone); Object.keys(p).forEach((k) => { if (k.startsWith(prefix)) { delete p[k]; p._gone[k] = now; } }); p._t = now; });
      C.store.update('cards', {}, (m) => { Object.keys(m).forEach((k) => { if (k.startsWith(prefix)) delete m[k]; }); m._t = Date.now(); });
      C.store.set(sessKey(c.id, u.id), null);
      C.render();
      C.toast(u.label + ' progress cleared.', { label: 'Undo', fn: () => {
        // restored answers are re-dated so they outrank the markers the clear left
        const now = Date.now(), p = JSON.parse(JSON.stringify(before.progress));
        Object.keys(p).forEach((k) => { if (k.startsWith(prefix) && p[k] && typeof p[k] === 'object') p[k].at = now; });
        if (p._gone) Object.keys(p._gone).forEach((k) => { if (k.startsWith(prefix)) delete p._gone[k]; });
        C.store.set('progress', C.stamp(p)); C.store.set('cards', C.stamp(before.cards)); C.store.set(sessKey(c.id, u.id), before.sess); C.render();
      } });
    };
    // teach-back: you explain the topic, Claude grades the explanation against the slides
    $$('[data-teach]', el).forEach((b) => (b.onclick = async () => {
      const i = +b.dataset.teach;
      const t = u.topics[i];
      const ctx = { course: c.id, unit: u.id, kind: 'topic', label: u.label + ' ' + t.n + ', explain it back', item: t, slide: t.sl && t.sl[0] ? [t.sl[0][0], t.sl[0][1]] : null };
      const block = await C.contextBlock(ctx);
      C.chat.open({
        ctx, label: ctx.label,
        seed: {
          user: '<context>\n' + block + '\n</context>\n\nI am going to explain "' + t.n + '" in my own words, as if to a classmate. When I do, grade it against the lecture: say what is right, what is missing or wrong, and give one follow-up question that tests the weakest part. Keep the feedback short.',
          shown: 'Teach-back: ' + t.n,
          assistant: 'Go ahead: explain **' + t.n + '** in your own words, as you would to a classmate before the exam. Cover what it is, why it matters in ' + c.code + ', and one example. I will tell you what is solid and what is missing.',
        },
        send: false,
      });
    }));
    $$('[data-explain]', el).forEach((b) => (b.onclick = () => {
      const i = +b.dataset.explain;
      const ctx = { course: c.id, unit: u.id, kind: 'topic', label: u.label + ' ' + u.topics[i].n, item: u.topics[i], slide: u.topics[i].sl && u.topics[i].sl[0] ? [u.topics[i].sl[0][0], u.topics[i].sl[0][1]] : null };
      C.explain(ctx, b);
    }));
    study.keys = null;
  }

  // ------------------------------------------------------------ topic mastery map
  function renderMap(el, c) {
    study.keys = null;
    const p = prog();
    const lvl = (m) => (!m.seen ? 'm0' : m.pct >= 0.85 ? 'm4' : m.pct >= 0.65 ? 'm3' : m.pct >= 0.4 ? 'm2' : 'm1');
    const rows = c.units.map((u) => {
      const topics = u.topics.map((t, i) => {
        const qs = u.quiz.filter((x) => (u.topics.length === 1 ? true : x.t === i));
        let seen = 0, right = 0;
        qs.forEach((x) => { const e = p[qkey(c.id, u.id, x)]; if (e) { seen++; if (e.last === 1) right++; } });
        return { t, i, n: qs.length, seen, right, pct: qs.length ? right / qs.length : 0 };
      }).filter((x) => x.n);
      const m = study.unitMastery(c.id, u);
      return '<div class="maprow"><a class="maprow__u" href="#/study/' + c.id + '/' + u.id + '"><span class="lab">' + esc(u.label) + '</span><span>' + esc(u.short || u.title) + '</span></a>' +
        '<div class="maprow__t">' + topics.map((x) => { const fl = study.topicFlagged(c.id, u.id, x.i); return '<a class="mcell ' + lvl(x) + (fl ? ' is-flag' : '') + '" href="#/study/' + c.id + '/' + u.id + '/quiz?t=' + (u.topics.length === 1 ? '' : x.i) + '" title="' + esc(x.t.n + ': ' + (x.seen ? x.right + ' of ' + x.n + ' right' : x.n + ' questions, not tried') + (fl ? '. Flagged' : '')) + '">' + (fl ? C.icon.flag + '<b class="visually-hidden">Flagged: </b>' : '') + esc(x.t.n) + '<span>' + (x.seen ? Math.round(x.pct * 100) + '%' : x.n) + '</span></a>'; }).join('') + '</div>' +
        '<span class="maprow__pct">' + (m.seen ? Math.round(m.pct * 100) + '%' : '') + '</span></div>';
    }).join('');
    el.innerHTML = '<header class="uhead"><div class="uhead__meta"><span class="ctag c-' + c.id + '">' + esc(c.code + ' ' + c.short) + '</span></div><h1>Topic mastery</h1>' +
      '<p class="uhead__src">Each topic shaded by the share of its questions you got right on the last try. Untried topics show their question count. Click one to drill it.</p></header>' +
      '<div class="legend maplegend"><span><i class="mcell m0"></i>not tried</span><span><i class="mcell m1"></i>under 40%</span><span><i class="mcell m2"></i>40 to 64%</span><span><i class="mcell m3"></i>65 to 84%</span><span><i class="mcell m4"></i>85% and up</span><span class="maplegend__flag">' + C.icon.flag + 'flagged</span></div>' +
      trend(c.id) +
      '<div class="map">' + rows + '</div>';
    if (C.chartTips) C.chartTips(el, trendDays(), { chAcc: (i) => { const d = trendData(c.id)[i]; return d.n ? Math.round((100 * d.r) / d.n) + '% of ' + d.n + ' answers' : 'no answers'; } });
  }
  const trendDays = () => { const t = C.today(), out = []; for (let k = 13; k >= 0; k--) out.push(C.addDays(t, -k)); return out; };
  function trendData(cid) {
    const log = C.store.get('answerLog', []) || [];
    return trendDays().map((d) => { const a = log.filter((x) => x[0] === d && x[1] === cid); return { n: a.length, r: a.filter((x) => x[2]).length }; });
  }
  // share right per day over two weeks: one series, one axis, hover and a spoken summary
  function trend(cid) {
    if (!C.chart) return '';
    const data = trendData(cid);
    const total = data.reduce((s, d) => s + d.n, 0);
    if (total < 5) return '<p class="muted mt-sm">Answer a few more questions and a two-week accuracy line appears here.</p>';
    return '<section class="trend">' + C.chart({ id: 'chAcc', title: 'Share answered right, last 14 days', days: trendDays(), values: data.map((d) => (d.n ? (100 * d.r) / d.n : null)), max: 100, fmt: (v) => Math.round(v) + '%', kind: 'line' }) + '</section>';
  }

  // ------------------------------------------------------------ timed mock exam: no feedback until you submit
  function renderMock(el, c, q) {
    const key = 'mock:' + c.id;
    let m = C.store.get(key);
    const exams = C.deadlines().filter((d) => d.course === c.id && d.kind === 'exam' && d.date >= C.today());
    const next = exams[0];
    study.keys = null;
    if (m && m.items) {
      m.items = study.resolve(c.id, m.items);
      // written problems are found again by their key, in case a rebuild reordered them
      m.written = (m.written || []).map((x) => { const u = C.data.unit(c.id, x.u); const i = u ? (u.written || []).findIndex((w) => wkey(c.id, u.id, w) === x.k) : -1; return i < 0 ? null : Object.assign(x, { i }); }).filter(Boolean);
      if (!m.items.length && !m.written.length) m = null;
    }
    if (m && m.state === 'live' && Date.now() >= m.ends) { m = finishMock(c, m); }
    const head = '<header class="uhead"><div class="uhead__meta"><span class="ctag c-' + c.id + '">' + esc(c.code + ' ' + c.short) + '</span>' + (next ? '<span>' + esc(next.title + ' ' + C.fmtShort(next.date) + ', ' + C.rel(next.date)) + '</span>' : '') + '</div><h1>Mock exam</h1></header>';
    if (!m || m.state === 'setup' || (m.state === 'done' && q.new === '1')) {
      const units = next ? study.examUnits(next) : c.units.map((u) => u.id);
      const hasWritten = c.units.some((u) => u.written && u.written.length);
      el.innerHTML = head +
        '<form class="wr" id="mockForm"><p class="uhead__src">Exam conditions: a countdown, no answers shown, change your mind freely, then submit. Every answer still feeds your review schedule.</p>' +
        '<fieldset class="filters" role="group"><legend class="visually-hidden">Lectures</legend>' + c.units.map((u) => '<label class="chip"><input class="visually-hidden" type="checkbox" name="u" value="' + u.id + '"' + (units.includes(u.id) ? ' checked' : '') + '><span>' + esc(u.label) + '</span></label>').join('') + '</fieldset>' +
        '<div class="grid2"><label class="field">Multiple-choice questions<select name="n">' + [0, 15, 25, 40].map((n) => '<option value="' + n + '"' + (n === 25 ? ' selected' : '') + '>' + (n || 'None') + '</option>').join('') + '</select></label>' +
        '<label class="field">Minutes per question<select name="mpq">' + [1, 1.5, 2, 3].map((n) => '<option' + (n === 1.5 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div>' +
        (hasWritten ? '<div class="grid2"><label class="field">Written problems<select name="nw">' + [0, 1, 2, 3].map((n) => '<option value="' + n + '"' + (n === 2 ? ' selected' : '') + '>' + (n || 'None') + '</option>').join('') + '</select><span class="field__help">Graded by Claude against the rubric after you submit.</span></label>' +
          '<label class="field">Minutes per written problem<select name="mpw">' + [10, 15, 20, 30].map((n) => '<option' + (n === 15 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div>' : '') +
        '<div><button class="btn btn--primary" type="submit">Start the clock</button></div></form>' +
        (m && m.state === 'done' ? '<p class="muted mt-lg"><a href="#/study/' + c.id + '/mock">See your last result</a></p>' : '');
      $$('#mockForm .chip input', el).forEach((i) => { const sync = () => i.parentElement.setAttribute('aria-pressed', String(i.checked)); sync(); i.onchange = sync; });
      $('#mockForm').onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const chosen = fd.getAll('u');
        const pool = [], wpool = [];
        c.units.filter((u) => !chosen.length || chosen.includes(u.id)).forEach((u) => {
          u.quiz.forEach((x, i) => pool.push({ u: u.id, i }));
          (u.written || []).forEach((w, i) => wpool.push({ u: u.id, i, k: wkey(c.id, u.id, w), a: '' }));
        });
        const r = rng(Date.now() % 100000);
        const n = Math.min(+fd.get('n'), pool.length);
        const nw = Math.min(+(fd.get('nw') || 0), wpool.length);
        if (!n && !nw) { C.toast('Those lectures have no questions yet. Pick others.'); return; }
        const items = shuffle(pool, r).slice(0, n).map((x) => Object.assign(study.item(c.id, x.u, C.data.unit(c.id, x.u).quiz[x.i], x.i, r), { flag: false }));
        const written = shuffle(wpool, r).slice(0, nw);
        C.store.set(key, { state: 'live', items, written, cur: 0, started: Date.now(), ends: Date.now() + (n * +fd.get('mpq') + nw * +(fd.get('mpw') || 15)) * 60000 });
        C.setQuery({ new: '' });
        C.render();
      };
      return;
    }
    if (m.state === 'done') return mockReport(el, c, m, head);
    // live: the multiple-choice questions, then the written problems, on one clock
    const W = m.written || [];
    const total = m.items.length + W.length;
    m.cur = Math.max(0, Math.min(m.cur, total - 1));
    const isW = m.cur >= m.items.length;
    const it = isW ? null : m.items[m.cur];
    const wr = isW ? W[m.cur - m.items.length] : null;
    const u = C.data.unit(c.id, isW ? wr.u : it.u);
    const item = isW ? null : u.quiz[it.i];
    const wq = isW ? u.written[wr.i] : null;
    const answered = m.items.filter((x) => x.pick != null).length + W.filter((x) => x.a.trim()).length;
    el.innerHTML = head +
      '<div class="qwrap"><div class="cardbar"><span class="mockclock" id="mockClock" role="timer" aria-live="off"></span><button class="btn btn--primary" type="button" id="mockSubmit">Submit exam</button></div>' +
      '<nav class="qnav" aria-label="Questions">' + m.items.map((x, k) => '<button class="navnum' + (x.pick != null ? ' is-answered' : '') + (x.flag ? ' is-flag' : '') + '" type="button" data-k="' + k + '" aria-current="' + (k === m.cur) + '" aria-label="Question ' + (k + 1) + (x.pick != null ? ', answered' : '') + (x.flag ? ', flagged' : '') + '">' + (k + 1) + '</button>').join('') +
      W.map((x, j) => { const k = m.items.length + j; return '<button class="navnum' + (x.a.trim() ? ' is-answered' : '') + '" type="button" data-k="' + k + '" aria-current="' + (k === m.cur) + '" aria-label="Written problem ' + (j + 1) + (x.a.trim() ? ', answered' : '') + '">W' + (j + 1) + '</button>'; }).join('') + '</nav>' +
      (isW
        ? '<article class="q" data-swipe="#mNext|#mPrev"><div class="q__meta"><span class="qnum">W' + (m.cur - m.items.length + 1) + '</span><span>' + esc(u.label) + '</span>' + (wq.pts ? '<span>' + wq.pts + ' points</span>' : '') + '</div>' +
          richQ(wq.q) + '<label class="field">Your answer<textarea id="mockAns" rows="12" placeholder="Write it the way you would on the exam: the formulation, the reasoning, the key steps.">' + esc(wr.a) + '</textarea></label></article>'
        : '<article class="q" data-swipe="#mNext|#mPrev"><div class="q__meta"><span class="qnum">Q' + (m.cur + 1) + '</span><span>' + esc(u.label) + '</span><button class="chip push" type="button" id="mockFlag" aria-pressed="' + it.flag + '">Flag for review</button></div>' +
          '<p class="q__text">' + C.inline(item.q) + '</p>' +
          '<div class="opts" role="radiogroup" aria-label="Answers">' + it.o.map((oi, pos) => '<button class="opt' + (it.pick === oi ? ' is-picked' : '') + '" type="button" role="radio" aria-checked="' + (it.pick === oi) + '" tabindex="' + ((it.pick == null ? pos === 0 : it.pick === oi) ? 0 : -1) + '" data-o="' + oi + '"><span class="let">' + L[pos] + '</span><span>' + C.inline(item.o[oi]) + '</span><span class="mark"></span></button>').join('') + '</div></article>') +
      '<div class="qfoot"><button class="btn" type="button" id="mPrev"' + (m.cur === 0 ? ' disabled' : '') + '>' + C.icon.left + ' Previous</button><span class="hint">' + answered + ' of ' + total + ' answered</span><button class="btn" type="button" id="mNext"' + (m.cur === total - 1 ? ' disabled' : '') + '>Next ' + C.icon.right + '</button></div></div>';
    C.renderMath(el);
    const save = () => C.store.set(key, m);
    const go = (k) => { m.cur = Math.max(0, Math.min(total - 1, k)); save(); renderMock(el, c, q); };
    $$('.navnum', el).forEach((b) => (b.onclick = () => go(+b.dataset.k)));
    if (isW) {
      // the answer is kept as you type; the nav square fills in once there is something
      $('#mockAns').oninput = (e) => {
        wr.a = e.target.value;
        save();
        const nb = el.querySelector('.navnum[data-k="' + m.cur + '"]');
        nb && nb.classList.toggle('is-answered', !!wr.a.trim());
        $('.qfoot .hint', el).textContent = (m.items.filter((x) => x.pick != null).length + W.filter((x) => x.a.trim()).length) + ' of ' + total + ' answered';
      };
    } else {
      $$('.opt', el).forEach((b) => (b.onclick = () => { it.pick = +b.dataset.o; save(); renderMock(el, c, q); const nb = el.querySelector('.opt[data-o="' + it.pick + '"]'); nb && nb.focus(); }));
      el.querySelector('[role="radiogroup"]').addEventListener('keydown', (e) => {
        const opts = $$('.opt', el);
        const i = opts.indexOf(document.activeElement);
        if (i < 0 || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const n = opts[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length];
        n.click();
      });
      $('#mockFlag').onclick = () => { it.flag = !it.flag; save(); renderMock(el, c, q); };
    }
    $('#mPrev').onclick = () => go(m.cur - 1);
    $('#mNext').onclick = () => go(m.cur + 1);
    $('#mockSubmit').onclick = (e) => {
      const left = total - m.items.filter((x) => x.pick != null).length - W.filter((x) => x.a.trim()).length;
      const b = e.currentTarget;
      if (left && b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = left + ' unanswered. Submit anyway?'; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = 'Submit exam'; } }, 4000); return; }
      finishMock(c, m); renderMock(el, c, q);
    };
    clearInterval(study._clock);
    const tick = () => {
      const ms = m.ends - Date.now();
      const clock = $('#mockClock');
      if (!clock) { clearInterval(study._clock); return; }
      if (ms <= 0) { clearInterval(study._clock); finishMock(c, m); renderMock(el, c, q); return; }
      const mm = Math.floor(ms / 60000), ss = Math.floor((ms % 60000) / 1000);
      clock.textContent = mm + ':' + String(ss).padStart(2, '0') + ' left';
      clock.classList.toggle('is-low', ms < 120000);
    };
    tick();
    study._clock = setInterval(tick, 1000);
    study.keys = (e) => {
      const k = e.key.toLowerCase();
      if (/^[1-6]$/.test(k)) { const b = $$('.opt', el)[+k - 1]; if (b) { b.click(); return true; } }
      if (k === 'arrowright') { go(m.cur + 1); return true; }
      if (k === 'arrowleft') { go(m.cur - 1); return true; }
      if (k === 'f' && $('#mockFlag')) { $('#mockFlag').click(); return true; }
      return false;
    };
  }
  function finishMock(c, m) {
    m.state = 'done';
    m.finished = Math.min(Date.now(), m.ends);
    m.items.forEach((x) => { const item = C.data.unit(c.id, x.u).quiz[x.i]; if (x.pick != null) record(qkey(c.id, x.u, item), x.pick === item.a, false); });
    const right = m.items.filter((x) => x.pick === C.data.unit(c.id, x.u).quiz[x.i].a).length;
    if (m.items.length) C.store.update('history', [], (h) => { h.push({ at: Date.now(), c: c.id, u: 'mock', n: m.items.length, r: right }); return h.slice(-400); });
    // written answers also show in each lecture's Written tab, unless you had already answered there
    const mine = (m.written || []).filter((x) => x.a.trim());
    if (mine.length) C.store.update('written', {}, (s) => { mine.forEach((x) => { if (!(s[x.k] && s[x.k].a)) s[x.k] = Object.assign(s[x.k] || {}, { a: x.a }); }); s._t = Date.now(); });
    C.store.set('mock:' + c.id, m);
    clearInterval(study._clock);
    return m;
  }
  // written points in a mock: what Claude has graded so far, out of the points those problems are worth
  const wpoints = {
    // a blank answer scores zero of its points without asking Claude
    // A problem is done once Claude has graded it or it was left blank (zero). Most problems carry no points:
    // Claude then gives a verdict, and only the scored ones add to the points.
    total: (wrows) => wrows.reduce((t, r) => {
      const blank = !r.x.a.trim();
      if (!blank && !r.x.fb) return t;
      t.n++;
      const s = blank ? (r.w.pts ? [0, r.w.pts] : null) : study.scoreOf(r.x.fb);
      if (s) { t.got += s[0]; t.of += s[1]; }
      return t;
    }, { got: 0, of: 0, n: 0, all: wrows.length }),
    totalHtml: (p) => {
      if (!p.n) return '<p class="muted">Written problems not graded yet.</p>';
      const done = p.n === p.all ? 'all ' + p.all + ' graded' : p.n + ' of ' + p.all + ' graded so far';
      return p.of ? '<div class="summary__fig">' + (Math.round(p.got * 10) / 10) + ' of ' + p.of + '</div><p class="muted">written points as Claude graded them, ' + done + '</p>'
        : '<div class="summary__fig">' + p.n + ' of ' + p.all + '</div><p class="muted">written problems graded; Claude’s verdict is under each</p>';
    },
  };
  function mockReport(el, c, m, head) {
    const rows = m.items.map((x) => { const u = C.data.unit(c.id, x.u); return { x, u, item: u.quiz[x.i] }; });
    const right = rows.filter((r) => r.x.pick === r.item.a).length;
    const byUnit = {};
    rows.forEach((r) => { const k = r.u.label; byUnit[k] = byUnit[k] || [0, 0]; byUnit[k][1]++; if (r.x.pick === r.item.a) byUnit[k][0]++; });
    const mins = Math.round((m.finished - m.started) / 60000);
    const W = m.written || [];
    const wrows = W.map((x) => { const u = C.data.unit(c.id, x.u); return { x, u, w: u.written[x.i] }; });
    const pts = wpoints.total(wrows);
    el.innerHTML = head +
      '<div class="summary">' +
      (rows.length ? '<div><div class="summary__fig">' + right + ' of ' + rows.length + '</div><p class="muted">' + Math.round((100 * right) / rows.length) + '% multiple choice, ' + mins + ' min in all</p></div>' : '<div><div class="summary__fig">' + W.length + ' written</div><p class="muted">' + mins + ' min</p></div>') +
      (rows.length ? '<dl class="stats">' + Object.entries(byUnit).map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v[0] + '/' + v[1] + '</dd></div>').join('') + '</dl>' : '') +
      (W.length ? '<div id="wTotal">' + wpoints.totalHtml(pts) + '</div>' : '') +
      '<div class="qactions"><a class="btn btn--primary" href="#/study/' + c.id + '/mock?new=1">New mock exam</a>' + (rows.length ? '<a class="btn" href="#/study/' + c.id + '/weak/quiz">Redo missed questions</a>' : '') + '</div>' +
      (W.length ? '<section class="mockw"><div class="cardbar"><h2>Written problems</h2>' + (wrows.some((r) => r.x.a.trim() && !r.x.fb) ? '<button class="btn btn--sm btn--primary" type="button" id="gradeAll">' + C.icon.spark + ' Grade all with Claude</button>' : '') + '</div>' +
        wrows.map((r, j) => '<article class="mockw__item" data-j="' + j + '"><div class="q__meta"><span class="qnum">W' + (j + 1) + '</span><span>' + esc(r.u.label) + '</span>' + (r.w.pts ? '<span>' + r.w.pts + ' points</span>' : '') + '</div>' +
          richQ(r.w.q) +
          '<div class="mockw__ans"><b>Your answer</b>' + (r.x.a.trim() ? '<p class="mockw__text">' + esc(r.x.a) + '</p>' : '<p class="muted">Left blank.</p>') + '</div>' +
          '<div class="prose mockw__fb" id="wFb' + j + '">' + (r.x.fb ? C.md(r.x.fb) : '') + '</div>' +
          '<div class="qactions">' + (r.x.a.trim() ? '<button class="btn btn--sm" type="button" data-grade="' + j + '">' + (r.x.fb ? 'Grade again' : 'Grade with Claude') + '</button>' : '') + '</div>' +
          '<details class="mockw__model"><summary>Model answer and rubric</summary>' + richA(r.w.m) + (r.w.k && r.w.k.length ? '<ul class="rubric">' + r.w.k.map((k) => '<li>' + C.inline(k) + '</li>').join('') + '</ul>' : '') + '</details></article>').join('') + '</section>' : '') +
      '<div class="topics">' + rows.map((r, k) => {
        const ok = r.x.pick === r.item.a;
        return '<details class="topic mockrow"><summary><span class="' + (ok ? 'diff--easy' : 'diff--hard') + '">' + (ok ? 'Right' : r.x.pick == null ? 'Blank' : 'Wrong') + '</span> Q' + (k + 1) + ' ' + esc(r.u.label) + ': ' + C.inline(r.item.q.length > 110 ? r.item.q.slice(0, 107) + '…' : r.item.q) + '</summary>' +
          '<div class="topic__body"><p>' + C.inline(r.item.q) + '</p><p><b>Answer:</b> ' + C.inline(r.item.o[r.item.a]) + (ok || r.x.pick == null ? '' : '<br><b>Yours:</b> ' + C.inline(r.item.o[r.x.pick])) + '</p>' + (r.item.e ? '<p class="muted">' + C.inline(r.item.e) + '</p>' : '') +
          (r.item.s ? '<p><button class="chip" type="button" data-sl="' + r.item.s[0] + ',' + r.item.s[1] + '">' + C.icon.slide + ' ' + esc(C.slideLabel(r.item.s)) + '</button></p>' : '') + '</div></details>';
      }).join('') + '</div></div>';
    C.renderMath(el);
    $$('[data-sl]', el).forEach((b) => (b.onclick = () => { const [fi, p] = b.dataset.sl.split(',').map(Number); C.slides.open(fi, p, { from: 'mock exam' }); }));
    // grading streams into each problem's box and is saved with the mock, so it survives a reload
    // Grading is saved only while this is still the course's mock: start a new one mid-grading and the old
    // replies are dropped rather than written over it. A problem already being graded is not graded twice.
    const totalEl = $('#wTotal', el);
    const busy = new Set();
    const current = () => (C.store.get('mock:' + c.id) || {}).started === m.started;
    const grade = async (j) => {
      if (busy.has(j)) return true;
      const r = wrows[j], box = $('#wFb' + j, el), btn = el.querySelector('[data-grade="' + j + '"]');
      if (!C.claude.available()) { C.toast('Claude is not connected. Start Carrel with Start Carrel.cmd, or add an API key in Settings.'); return false; }
      busy.add(j);
      if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
      try {
        const fb = await study.gradeWritten(c.id, r.u, r.x.i, r.x.a, (t) => box.isConnected && C.html(box, C.md(t)));
        if (!current()) return false;
        r.x.fb = fb;
        C.store.set('mock:' + c.id, m);
        if (totalEl && totalEl.isConnected) totalEl.innerHTML = wpoints.totalHtml(wpoints.total(wrows));
        if (btn) btn.textContent = 'Grade again';
        return true;
      } catch (e) { if (box.isConnected) box.innerHTML = '<p class="msg__err">' + esc(C.friendlyError(e)) + '</p>'; return false; }
      finally { busy.delete(j); if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); } }
    };
    $$('[data-grade]', el).forEach((b) => (b.onclick = () => grade(+b.dataset.grade)));
    if ($('#gradeAll', el)) $('#gradeAll', el).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      let ok = true;
      for (let j = 0; j < wrows.length && ok; j++) if (wrows[j].x.a.trim() && !wrows[j].x.fb) ok = await grade(j);
      // after a failure the button stays, to try the rest again
      if (ok || !b.isConnected) b.remove(); else { b.disabled = false; b.textContent = 'Grade the rest with Claude'; }
    };
  }

  // ------------------------------------------------------------ swipe (phones): left for next, right for previous
  // on a question, flashcard or mock item; the element names its buttons in data-swipe="next selector|prev selector"
  let touch = null;
  document.addEventListener('touchstart', (e) => {
    const el = e.target.closest && e.target.closest('[data-swipe]');
    touch = el && e.touches.length === 1 && !e.target.closest('input, textarea, select, .qnav, .katex-display, .slides') ? { el, x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!touch || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    const el = touch.el;
    touch = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6 || !el.isConnected) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // a drag that selected text, not a swipe
    const [next, prev] = el.dataset.swipe.split('|');
    const b = document.querySelector(dx < 0 ? next : prev);
    if (b && !b.disabled) { b.click(); if (navigator.vibrate) navigator.vibrate(8); }
  }, { passive: true });

  // ------------------------------------------------------------ keyboard
  document.addEventListener('keydown', (e) => {
    if (C._lastView !== 'study' || !study.keys) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], dialog, #drawer, .explain')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!C.shortcutsOn()) return;
    if ((e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) && e.target.closest && e.target.closest('a, button, [role="radio"], [role="button"]') && !e.target.classList.contains('opt')) return;
    if (study.keys(e)) e.preventDefault();
  });
})();
