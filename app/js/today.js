/* Today: the day and what is on it, then Canvas assignments, Canvas announcements and the week side by side, then study, mail and body below. No cards. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;

  function headline(t, upcoming) {
    const exams = upcoming.filter((d) => d.kind === 'exam');
    if (!exams.length) {
      const next = upcoming[0];
      return next ? 'Next up: ' + C.data.courseName(next.course) + ' ' + next.title + ', ' + C.rel(next.date) + '.' : 'Nothing due in the next nine days.';
    }
    return exams.slice(0, 2).map((e) => C.data.courseName(e.course) + ' ' + e.title.replace(/^\*+|\*+$/g, '') + ' ' + C.rel(e.date)).join('. ') + '.';
  }

  C.routes.today = {
    title: 'Today',
    render(main) {
      const t = C.today();
      const all = C.deadlines();
      const upcoming = all.filter((d) => d.date >= t && d.date <= C.addDays(t, 9));
      const classes = C.classesOn(t);
      const exams = all.filter((d) => d.kind === 'exam' && d.date >= t && d.date <= C.addDays(t, 21));
      const x = C.recovery && C.recovery.compute(t);

      // within a week of an exam: the two lectures in its scope you know least, and your own notes on them
      const weakest = (e, units) => {
        if (C.daysBetween(t, e.date) > 7) return '';
        const c = C.data.course(e.course);
        const all = c.units.filter((u) => units.includes(u.id) && u.quiz.length && /^[LR]\d/.test(u.label)).map((u) => ({ u, m: C.study.unitMastery(e.course, u) }));
        // weakest means least often right among lectures you have tried; untried ones are named as such
        const tried = all.filter((r) => r.m.seen >= 5).sort((a, b) => a.m.right / a.m.seen - b.m.right / b.m.seen).slice(0, 2);
        const fresh = all.filter((r) => !r.m.seen).slice(0, Math.max(0, 2 - tried.length));
        if (!tried.length && !fresh.length) return '';
        const link = (r) => '<a href="#/study/' + e.course + '/' + r.u.id + '">' + esc(r.u.label + ' ' + (r.u.short || r.u.title)) + '</a>';
        const notes = C.notes ? [...new Map(tried.concat(fresh).flatMap((r) => C.notes.best(e.course, r.u, 1)).map((n) => [n.path, n])).values()] : [];
        return '<p class="runway__weak">' +
          (tried.length ? 'Weakest so far: ' + tried.map((r) => link(r) + ' (' + r.m.right + ' of ' + r.m.seen + ' right)').join(', ') + '. ' : '') +
          (fresh.length ? 'Not started: ' + fresh.map(link).join(', ') + '. ' : '') +
          (notes.length ? 'Reread your ' + notes.map((n) => '<button class="linkbtn" type="button" data-note="' + esc(n.path) + '">' + esc(n.title) + '</button>').join(' and ') + '.' : '') + '</p>';
      };
      // written problems in the exam's scope you have answered (in the Written tab or a mock), with the way in
      const writtenLine = (e, units) => {
        const c = C.data.course(e.course);
        const mine = C.store.get('written', {}) || {};
        let total = 0, tried = 0;
        c.units.filter((u) => units.includes(u.id)).forEach((u) => (u.written || []).forEach((w) => {
          total++;
          const s = mine[e.course + ':' + u.id + ':w' + C.hash(w.q)];
          if (s && s.a && s.a.trim()) tried++;
        }));
        if (!total) return '';
        return '<p class="runway__weak">Written practice: ' + tried + ' of ' + total + ' problems answered. <a href="#/study/' + e.course + '/mock?new=1">Timed, with Claude grading</a>.</p>';
      };
      const runway = exams.map((e) => {
        const units = C.study.examUnits(e);
        const m = C.study.courseMastery(e.course, units);
        if (!m || !m.total) return '';
        return '<div class="runway__row c-' + e.course + '"><div><b>' + esc(C.data.courseName(e.course) + ' ' + e.title) + '</b><div class="muted">' + m.right + ' of ' + m.total + ' questions right, ' + (m.total - m.seen) + ' not tried</div></div>' +
          '<a class="btn btn--sm" href="#/study/' + e.course + '/exam/quiz?units=' + units.join(',') + '">Drill</a>' +
          '<div class="meter" role="img" aria-label="' + Math.round(m.pct * 100) + ' percent mastered"><i style="--v:' + m.pct.toFixed(3) + '"></i></div>' +
          weakest(e, units) + writtenLine(e, units) + '</div>';
      }).join('');

      const examToday = all.filter((d) => d.kind === 'exam' && d.date === t);
      const examBlock = examToday.map((e) => {
        const cls = C.classesOn(t).find((k) => k.course === e.course);
        const when = e.time || (cls && cls.start);
        const units = C.study.examUnits(e);
        const p = C.store.get('progress', {});
        const c = C.data.course(e.course);
        const missed = units.length ? c.units.filter((u) => units.includes(u.id)).reduce((n, u) => n + u.quiz.filter((q) => { const x = p[C.study.qkey(e.course, u.id, q)]; return x && x.last === 0; }).length, 0) : 0;
        return '<section class="examday c-' + e.course + '"><span class="ctag">' + esc(c.code + ' ' + c.short) + '</span><h2>' + esc(e.title + ' today') + '</h2>' +
          '<p>' + esc((when ? C.fmtTime(when) : 'Time not in the planner') + (cls ? ', ' + cls.loc : '') + '.') + (e.notes ? ' ' + esc(e.notes) : '') + '</p>' +
          (units.length ? '<p class="qactions"><a class="btn btn--primary" href="#/sheet/' + e.course + '?units=' + units.join(',') + '">Last look: review sheet</a>' + (missed ? '<a class="btn" href="#/study/' + e.course + '/weak/quiz">Redo ' + missed + ' missed</a>' : '') + '</p>' : '') + '</section>';
      }).join('');
      // the day's header: date, then what is on today (classes, what is due, Outlook)
      const dueToday = all.filter((d) => d.date === t && d.kind !== 'exam');
      const olToday = C.sync && C.sync.eventsOn ? C.sync.eventsOn(t).filter((e) => !e.cont) : [];
      const sub = [];
      classes.forEach((c) => sub.push('<li class="c-' + c.course + '"><time>' + C.fmtTime(c.start) + '</time>' + esc((C.data.course(c.course) || {}).short + ' ' + c.title.toLowerCase()) + (c.loc ? '<span class="muted">' + esc(c.loc) + '</span>' : '') + '</li>'));
      olToday.forEach((e) => sub.push('<li class="is-outlook"><time>' + (e.start ? C.fmtTime(e.start) : 'all day') + '</time>' + esc(e.title) + (e.loc ? '<span class="muted">' + esc(e.loc) + '</span>' : '') + '</li>'));
      dueToday.forEach((d) => sub.push('<li class="is-due c-' + (d.course || 'me') + (C.isDone(d.id) ? ' is-done' : '') + '"><time>' + (d.time ? 'due ' + C.fmtTime(d.time) : 'due') + '</time>' + esc(d.title) + '<span class="ctag">' + esc(C.data.courseName(d.course)) + '</span></li>'));
      sub.sort((a, b) => clock(a) - clock(b));
      main.innerHTML =
        '<div class="page"><div class="tday">' +
        '<header class="tday__head"><div class="tday__title"><h1>' + esc(C.fmtLong(t)) + '</h1>' +
        '<button class="btn" type="button" id="coach">' + C.icon.spark + ' Plan my next study session</button></div>' +
        phoneStudy() +
        (examBlock || '<p class="tday__lead">' + esc(headline(t, upcoming)) + '</p>') +
        (sub.length ? '<ul class="tday__sub" aria-label="Today">' + sub.join('') + '</ul>' : '<p class="muted">No classes and nothing due today.</p>') + '</header>' +
        '<div class="tday__cols">' +
        '<div class="tday__col">' + (C.sync ? C.sync.assignmentSection() : '') + '</div>' +
        '<div class="tday__col">' + (C.sync ? C.sync.announcementSection() || '<section><h2>Canvas announcements</h2><p class="muted">Waiting for the local server.</p></section>' : '') + '</div>' +
        '<div class="tday__col"><section><div class="cardbar"><h2>This week</h2><a class="btn btn--sm btn--quiet" href="#/calendar">Calendar</a></div><div id="todayTasks"></div></section></div>' +
        '</div>' +
        // everything else, grouped: study, then mail and planning, then body
        '<div class="tday__more">' +
        (runway ? '<section><h2>Exam runway</h2><div class="runway">' + runway + '</div></section>' : '') +
        dueSection() +
        planSection(t) +
        (C.sync ? C.sync.mailSection() : '') +
        (C.backplan ? C.backplan.section() : '') +
        newDecksSection() +
        resume() +
        '<section><h2>Study activity</h2>' + C.focus.heatmap() + '</section>' +
        '<section><h2>Readiness</h2>' + (x ? '<div class="readiness"><span class="bigfig">' + x.readiness + '</span><div><b>' + C.recovery.label(x.readiness)[0] + '</b><p>' + esc(C.recovery.label(x.readiness)[1]) + '</p></div></div>' : '<p class="muted">Log last night’s sleep to get a readiness call.</p>') +
        '<p><a href="#/recovery">' + (x ? 'Recovery details' : 'Log sleep') + '</a></p></section>' +
        recoverySection(x) +
        '</div></div></div>';
      C.routes.today.refreshTasks();
      C.renderMath(main); // task titles from the vault can carry $math$
      $('#coach').onclick = () => C.chat.open({ ctx: null, label: 'Study session plan', prompt: 'Plan my next study session. Use my deadlines, mastery, tasks, review queue and readiness. Give a time-boxed plan (blocks with minutes) for the next 2 hours, say which Carrel set to open for each block (lecture labels like L5, the review queue, the exam drill, written practice, or a mock exam) or which of my own notes to reread, and one thing to skip tonight. Keep it under 200 words.' });
    },
    // the week's deadlines and tasks; Canvas-only items are in their own column
    refreshTasks() {
      const box = $('#todayTasks');
      if (!box) return;
      const t = C.today();
      const all = C.tasks.sorted(C.tasks.all(7)).filter((x) => x.kind !== 'study' && !/^Canvas/.test(x.src) && (!x.doneAt || x.doneAt > Date.now() - 12 * 3600e3));
      const list = all.slice(0, 12);
      box.innerHTML = list.length ? '<ul class="tlist" style="padding: 0">' + list.map((x) =>
        '<li class="task c-' + x.course + (x.doneAt ? ' is-done' : '') + '" data-id="' + esc(x.id) + '"><button class="check" type="button" role="checkbox" aria-checked="' + !!x.doneAt + '" aria-label="' + esc((x.doneAt ? 'Mark not done: ' : 'Mark done: ') + x.title) + '">' + C.icon.check + '</button><div class="task__body"><span class="task__title">' + (x.link ? '<a href="' + x.link + '">' + esc(x.title) + '</a>' : esc(x.title)) + '</span><span class="task__meta"><span class="ctag">' + esc(C.data.courseName(x.course)) + '</span><span class="due' + (x.due === t ? ' is-today' : x.due && x.due < t ? ' is-late' : '') + '">' + esc(x.due ? (x.due === t ? 'Today' : x.due === C.addDays(t, 1) ? 'Tomorrow' : C.fmtShort(x.due)) : 'No date') + (x.time ? ' ' + C.fmtTime(x.time) : '') + '</span></span></div><span></span></li>').join('') + '</ul>' +
        '<p><a href="#/tasks">All tasks' + (all.length > list.length ? ' (' + (all.length - list.length) + ' more this week)' : '') + '</a></p>'
        : '<p class="muted">Nothing due in the next seven days. <a href="#/tasks">Add a task</a></p>';
      $$('.check', box).forEach((b) => (b.onclick = () => { C.tasks.toggle(b.closest('.task').dataset.id); C.routes.today.refreshTasks(); C.emit('tasks', box); }));
      C.renderMath(box);
    },
  };

  // sort the header's items by their time; "due" with no time and all-day events go last and first
  function clock(li) {
    const m = /<time>(?:due )?(\d{1,2})(?::(\d\d))?\s*(am|pm)?/.exec(li);
    if (/<time>all day/.test(li)) return -1;
    if (!m) return 24 * 60;
    let h = +m[1] % 12;
    if (m[3] === 'pm') h += 12;
    return h * 60 + (+m[2] || 0);
  }
  // sleep and training at a glance, beside readiness
  function recoverySection(x) {
    const d = C.store.get('recovery', {}) || {};
    const last = (d.workouts || []).slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!x && !last) return '';
    return '<section><h2>Sleep and training</h2><dl class="parts">' +
      (x ? '<div><dt>Recovery</dt><dd>' + x.recovery + ', ' + esc(C.recovery.label(x.recovery)[0].toLowerCase()) + '</dd></div><div><dt>Last night</dt><dd>' + x.sleep.h.toFixed(1) + ' h, sleep score ' + x.sleep.score + '</dd></div>' +
        '<div><dt>Training load</dt><dd>' + (x.load.acwr == null ? 'no workouts in 4 weeks' : (x.load.acwr > 1.3 ? 'ramping fast' : x.load.acwr < 0.8 ? 'backing off' : 'steady') + ' (' + x.load.acwr.toFixed(2) + ')') + '</dd></div>' : '') +
      (last ? '<div><dt>Last workout</dt><dd>' + esc(last.type + ', ' + last.min + ' min, ' + (last.date === C.today() ? 'today' : C.fmtShort(last.date))) + '</dd></div>' : '') +
      '</dl><p><a href="#/recovery">Log a workout</a></p></section>';
  }

  function newDecksSection() {
    const list = C.newdecks ? C.newdecks.list : [];
    if (!list.length) return '';
    return '<section><h2>New lecture PDFs</h2><div class="runway">' + list.slice(0, 4).map((d) => '<div class="runway__row c-' + d.course + '"><div><b>' + esc(d.file.replace(/\.pdf$/i, '')) + '</b><div class="muted">' + esc(C.data.courseName(d.course)) + ', in the vault since ' + esc(C.fmtShort(d.modified)) + '</div></div><a class="btn btn--sm" href="#/study/' + d.course + '/new?path=' + encodeURIComponent(d.path) + '">Build a set</a></div>').join('') + '</div></section>';
  }
  function dueSection() {
    const rows = C.data.courses().filter((c) => c.units.length).map((c) => [c, C.study.dueCount(c.id)]).filter((x) => x[1] > 0);
    if (!rows.length) return '';
    const total = rows.reduce((s, r) => s + r[1], 0);
    return '<section><div class="cardbar"><h2>Due for review</h2>' + (rows.length > 1 ? '<a class="btn btn--sm btn--primary" href="#/review">Review all ' + total + '</a>' : '') + '</div><div class="runway">' + rows.map(([c, n]) => '<div class="runway__row c-' + c.id + '"><div><b>' + esc(c.code + ' ' + c.short) + '</b><div class="muted">' + n + (n === 1 ? ' question' : ' questions') + ' on today’s schedule</div></div><a class="btn btn--sm" href="#/study/' + c.id + '/due/quiz">Review</a></div>').join('') + '</div></section>';
  }
  function planSection(t) {
    if (!C.plan) return '';
    const items = C.plan.items(t, C.addDays(t, 6));
    if (!items.length) return '';
    const byDay = {};
    items.forEach((it) => (byDay[it.date] = byDay[it.date] || []).push(it));
    const done = (C.store.get('tasks', {}).done || {});
    return '<section><div class="cardbar"><h2>Study plan</h2><button class="btn btn--sm btn--quiet" type="button" id="planRebuild" title="Re-plan from your current scores">Rebuild</button></div><div class="ledger">' +
      Object.keys(byDay).sort().map((d) => '<div class="ledger__row"><span class="ledger__when">' + (d === t ? 'Today' : esc(C.fmtShort(d))) + '</span><span class="ledger__what">' +
        byDay[d].map((it) => '<a class="planitem c-' + it.course + (done[it.id] ? ' is-done' : '') + '" href="' + it.link + '">' + esc(it.title) + '</a>').join('') + '</span><span></span></div>').join('') +
      '</div></section>';
  }
  document.addEventListener('click', (e) => { if (e.target.id === 'planRebuild') { C.plan.rebuild(); C.render(); C.toast('Plan rebuilt from your current scores.'); } });

  // phones open on Today; one tap back into studying: the last set, and the review queue
  function phoneStudy() {
    const last = C.store.get('lastStudy');
    const c = last && last.c && C.data.course(last.c);
    const u = c && c.units && c.units.find((x) => x.id === last.u);
    const due = C.data.courses().filter((x) => x.units.length).reduce((n, x) => n + C.study.dueCount(x.id), 0);
    if (!c && !due) return '';
    return '<p class="tday__study qactions">' +
      (c ? '<a class="btn btn--primary" href="#/study/' + last.c + '/' + last.u + '/' + (last.m || 'quiz') + '">Continue ' + esc(u ? u.label + ' ' + (u.short || u.title) : c.short) + '</a>' : '') +
      (due ? '<a class="btn" href="#/review">Review ' + due + ' due</a>' : '') + '</p>';
  }
  function resume() {
    const last = C.store.get('lastStudy');
    if (!last || !last.c) return '';
    const c = C.data.course(last.c);
    const u = c && c.units && c.units.find((x) => x.id === last.u);
    const label = u ? u.label + ' ' + (u.short || u.title) : last.u === 'exam' ? 'Exam drill' : 'Missed questions';
    return '<section><h2>Pick up where you left off</h2><p><a class="btn" href="#/study/' + last.c + '/' + last.u + '/' + (last.m || 'quiz') + '">' + esc(c.code + ' ' + label) + '</a></p></section>';
  }
})();
