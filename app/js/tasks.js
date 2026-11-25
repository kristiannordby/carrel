/* Tasks: this week's deadlines, A-Lab goals from the newest weekly-update deck, exam prep, and your own.
   Checking one strikes it through and moves it to the bottom. A class rail filters the list. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const tasks = (C.tasks = {});
  const RAIL = [['all', 'All'], ['c57', null], ['095', null], ['alab', null], ['faa', null], ['hodl', null], ['072', null], ['me', 'Personal']];

  const state = () => Object.assign({ custom: [], done: {} }, C.store.get('tasks', {}));
  tasks.toggle = function (id) {
    const remote = C.sync && C.sync.doneRemote ? C.sync.doneRemote(id) : false; // submitted on Canvas
    C.store.update('tasks', {}, (s) => {
      s.done = s.done || {};
      s.undone = s.undone || {};
      if (s.done[id]) { delete s.done[id]; if (remote) s.undone[id] = Date.now(); }
      else if (remote && !s.undone[id]) s.undone[id] = Date.now(); // re-open it here; Canvas is unchanged
      else if (remote) delete s.undone[id];
      else s.done[id] = Date.now();
      s._t = Date.now();
    });
  };

  // every task, derived and custom, with a stable id
  tasks.all = function (windowDays) {
    const t = C.today();
    const end = C.addDays(t, windowDays == null ? C.settings().taskWindow : windowDays);
    const s = state();
    const out = [];
    C.deadlines().forEach((d) => {
      if (d.date < t || d.date > end) return;
      out.push({ id: d.id, title: d.title, course: d.course || 'me', due: d.date, time: d.time, src: d.src === 'planner' ? 'planner.md' + (d.canvas ? ' and Canvas' : '') : d.src === 'alab' ? 'A-Lab deck' : d.src === 'canvas' ? 'Canvas' + (d.canvasCourse && d.course === 'canvas' ? ', ' + d.canvasCourse : '') : 'calendar', major: d.major || d.kind === 'exam', kind: d.kind, url: d.url || (d.canvas && d.canvas.url) });
    });
    if (C.plan) C.plan.items(t, end).forEach((p) => out.push({ id: p.id, title: p.title, course: p.course, due: p.date, src: 'study plan for ' + p.exam, link: p.link, kind: 'study' }));
    const al = C.data.vault().alab || {};
    if (al.week && al.week[1] >= t) {
      const due = al.week[1];
      (al.mine || []).forEach((x) => out.push({ id: 'alab-me-' + C.hash(x), title: x, course: 'alab', due, src: 'your goals in ' + al.source, major: true }));
      (al.group || []).forEach((x) => out.push({ id: 'alab-gr-' + C.hash(x), title: x, course: 'alab', due, src: 'team goals in ' + al.source }));
    }
    // review-list items are due the day before that course's next exam
    const nextExam = (cid) => C.deadlines().find((d) => d.course === cid && d.kind === 'exam' && d.date >= t);
    (C.data.vault().followups || []).forEach((x) => {
      let due = x.due;
      if (!due && x.kind === 'review') { const ex = nextExam(x.course); if (ex) due = C.addDays(ex.date, -1) < t ? t : C.addDays(ex.date, -1); }
      if (!due || due <= end) out.push({ id: x.id, title: x.title, course: x.course, due, src: 'vault: ' + x.src.split('/').slice(-2).join('/'), detail: x.kind === 'review' ? null : x.detail, review: x.kind === 'review' ? x.detail : null, major: !!x.flagged });
    });
    (s.custom || []).forEach((x) => out.push(Object.assign({ src: 'added by you', custom: true }, x)));
    const flags = s.flag || {}, hidden = s.hidden || {}, edits = s.edits || {};
    out.forEach((x) => { x.doneAt = s.done[x.id] || (C.isDone(x.id) ? 1 : null); x.flag = !!flags[x.id]; if (edits[x.id]) Object.assign(x, edits[x.id], { edited: true }); });
    return out.filter((x) => !hidden[x.id]);
  };
  tasks.patch = function (fn) { C.store.update('tasks', {}, (s) => { s.done = s.done || {}; s.flag = s.flag || {}; s.hidden = s.hidden || {}; s.edits = s.edits || {}; s.custom = s.custom || []; fn(s); s._t = Date.now(); }); };
  // one header per stretch of time, so the list reads as a week
  tasks.group = function (x, t) {
    if (x.doneAt) return 'Done';
    if (!x.due) return 'No date';
    if (x.due < t) return 'Overdue';
    if (x.due === t) return 'Today';
    if (x.due === C.addDays(t, 1)) return 'Tomorrow';
    if (x.due <= C.addDays(t, 6)) return 'This week';
    return 'Later';
  };
  tasks.sorted = function (list) {
    const k = (x) => (x.due || '9999') + (x.flag ? 0 : 1) + (x.time || '99') + (x.major ? 0 : 1);
    const open = list.filter((x) => !x.doneAt).sort((a, b) => k(a).localeCompare(k(b)));
    const done = list.filter((x) => x.doneAt).sort((a, b) => a.doneAt - b.doneAt);
    return open.concat(done);
  };

  // ------------------------------------------------------------ the panel (full page or drawer)
  tasks.mount = function (el, opts) {
    const compact = opts && opts.compact;
    const key = compact ? 'drawer' : 'page';
    const ui = (tasks.ui = tasks.ui || {});
    ui[key] = ui[key] || { course: compact ? 'all' : (C.route.q.c || 'all'), win: C.settings().taskWindow };
    const st = ui[key];
    const all = tasks.all(st.win);
    const count = (id) => all.filter((x) => !x.doneAt && (id === 'all' || x.course === id)).length;
    const list = tasks.sorted(all.filter((x) => st.course === 'all' || x.course === st.course));
    const t = C.today();
    const name = (id, lab) => lab || C.data.courseName(id);
    const openN = list.filter((x) => !x.doneAt).length;
    el.innerHTML =
      '<div class="taskpanel' + (compact ? ' taskpanel--drawer' : '') + '">' +
      '<nav class="tcourses" aria-label="Filter by class">' + RAIL.map(([id, lab]) => '<button type="button" class="c-' + id + '" data-c="' + id + '" aria-pressed="' + (st.course === id) + '"><span class="nm"><span>' + esc(name(id, lab)) + '</span></span><span class="n">' + (count(id) || '') + '</span></button>').join('') + '</nav>' +
      '<div class="tmain">' +
      '<div class="thead"><h2>' + esc(st.course === 'all' ? 'All tasks' : name(st.course)) + ' <span class="muted">' + openN + ' open</span></h2>' +
      '<div class="seg" role="group" aria-label="How far ahead">' + [[7, 'Week'], [14, '2 weeks'], [60, 'Later']].map(([n, lab]) => '<button type="button" data-w="' + n + '" aria-pressed="' + (st.win === n) + '">' + lab + '</button>').join('') + '</div></div>' +
      '<form class="tadd" autocomplete="off"><label class="visually-hidden" for="tNew' + key + '">New task</label><input id="tNew' + key + '" type="text" name="title" placeholder="Add a task, press Enter">' +
      '<label class="visually-hidden" for="tCourse' + key + '">Class</label><select id="tCourse' + key + '" name="course">' + RAIL.slice(1).map(([id, lab]) => '<option value="' + id + '"' + (st.course === id ? ' selected' : '') + '>' + esc(name(id, lab)) + '</option>').join('') + '</select>' +
      '<label class="visually-hidden" for="tDue' + key + '">Due date</label><input id="tDue' + key + '" type="date" name="due" value="' + t + '">' +
      '<button class="btn btn--primary" type="submit">Add</button></form>' +
      '<ul class="tlist" aria-label="Tasks">' + (list.length ? list.map((x, i) => row(x, t, i === 0 || tasks.group(x, t) !== tasks.group(list[i - 1], t))).join('') : '<li class="state"><h3>Nothing due in this window</h3><p>Widen it to two weeks, or add a task above.</p></li>') + '</ul>' +
      (st.course === 'alab' && !compact ? alabPanel() : '') +
      '</div></div>';
    C.renderMath(el);
    const cur = $('.tcourses [aria-pressed="true"]', el);
    if (cur && cur.scrollIntoView && window.matchMedia('(max-width: 48rem)').matches) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    $$('[data-c]', el).forEach((b) => (b.onclick = () => { st.course = b.dataset.c; if (!compact) C.setQuery({ c: st.course === 'all' ? '' : st.course }); tasks.mount(el, opts); }));
    $$('[data-w]', el).forEach((b) => (b.onclick = () => { st.win = +b.dataset.w; tasks.mount(el, opts); }));
    $('.tadd', el).onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = (fd.get('title') || '').trim();
      if (!title) return;
      const course = compact && st.course !== 'all' ? st.course : fd.get('course') || 'me';
      C.store.update('tasks', {}, (s) => { s.custom = s.custom || []; s.custom.push({ id: 'me-' + C.uid(), title, course: compact && st.course === 'all' ? 'me' : course, due: compact ? null : fd.get('due') || null }); s._t = Date.now(); });
      tasks.mount(el, opts);
      const inp = $('input[name="title"]', el); inp && inp.focus();
      C.emit('tasks', el);
    };
    $$('.check', el).forEach((b) => (b.onclick = () => {
      const li = b.closest('.task');
      const before = rects(el);
      tasks.toggle(li.dataset.id);
      tasks.mount(el, opts);
      flip(el, before);
      C.emit('tasks', el);
      const nb = $('.task[data-id="' + CSS.escape(li.dataset.id) + '"] .check', el); nb && nb.focus({ preventScroll: true });
    }));
    $$('[data-flag]', el).forEach((b) => (b.onclick = () => { const id = b.dataset.flag; tasks.patch((s) => { if (s.flag[id]) delete s.flag[id]; else s.flag[id] = 1; }); tasks.mount(el, opts); C.emit('tasks', el); }));
    $$('[data-hide]', el).forEach((b) => (b.onclick = () => {
      const id = b.dataset.hide;
      tasks.patch((s) => (s.hidden[id] = Date.now()));
      tasks.mount(el, opts);
      C.toast('Task hidden.', { label: 'Undo', fn: () => { tasks.patch((s) => delete s.hidden[id]); tasks.mount(el, opts); } });
    }));
    if ($('#alabDraft', el)) $('#alabDraft', el).onclick = () => {
      const al = C.data.vault().alab || {};
      const s = state();
      const mine = (al.mine || []).map((x) => (s.done['alab-me-' + C.hash(x)] ? '[done] ' : '[open] ') + x);
      const group = (al.group || []).map((x) => (s.done['alab-gr-' + C.hash(x)] ? '[done] ' : '[open] ') + x);
      C.chat.open({
        ctx: null, label: 'A-Lab weekly update draft',
        prompt: 'Draft the next weekly sponsor update for my A-Lab team (MIT Analytics Lab). Use the same structure as our last deck (' + (al.source || 'the latest weekly update') + '): Weekly progress, Upcoming milestones, Next week\u2019s action plan, Decisions and support needed from the sponsor. Base it on what follows; mark anything you are inferring with [check].\n\nThis week (' + (al.week ? al.week.join(' to ') : '') + '), my items:\n' + mine.join('\n') + '\n\nTeam items:\n' + group.join('\n') + '\n\nTeammates:\n' + Object.entries(al.team || {}).map(([w, it]) => w + ': ' + it.join('; ')).join('\n') +
          '\n\nTeam checklist:\n' + (al.weekly || []).join('\n') + '\n\nSponsor answers last meeting:\n' + (al.questions || []).map((q) => 'Q: ' + q.q + ' A: ' + q.a).join('\n') + '\n\nMilestones:\n' + (al.milestones || []).map((m) => m.date + ' ' + m.title).join('\n') +
          (al.notes && al.notes.length ? '\n\nEarlier meeting notes with the sponsor (for decisions already made):\n' + al.notes.map((n) => '--- ' + n.file + ' (' + n.date + ')\n' + n.text).join('\n') : '') +
          '\n\nKeep each section to 3 to 5 bullets that would fit on one slide. Then list 2 questions worth asking the sponsor next.',
      });
    };
    $$('[data-review]', el).forEach((b) => (b.onclick = () => {
      const x = all.find((y) => y.id === b.dataset.review);
      if (!x) return;
      C.chat.open({
        ctx: null, label: x.title,
        prompt: 'This is from my own review list for ' + C.data.courseName(x.course) + '. I flagged it because I got the answer without fully understanding why. My notes:\n\n' + x.review + '\n\nRun a short review session: ask me to reproduce the key reasoning cold, one step at a time, wait for my answer each time, and correct me precisely. Start with the first question only.',
      });
    }));
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => edit(el, opts, b.closest('.task'), all.find((x) => x.id === b.dataset.edit))));
    $$('[data-del]', el).forEach((b) => (b.onclick = () => {
      const id = b.dataset.del;
      const before = state();
      C.store.update('tasks', {}, (s) => { s.custom = (s.custom || []).filter((x) => x.id !== id); s._t = Date.now(); });
      tasks.mount(el, opts);
      C.toast('Task deleted.', { label: 'Undo', fn: () => { C.store.set('tasks', before); tasks.mount(el, opts); } });
    }));
  };

  // the newest weekly-update deck, summarized: who owns what this week, what the sponsor answered, what is next
  function alabPanel() {
    const al = C.data.vault().alab || {};
    if (!al.source) return '';
    const t = C.today();
    const team = Object.entries(al.team || {});
    const next = (al.milestones || []).filter((m) => m.date >= t).slice(0, 4);
    return '<details class="alab" open><summary>Week ' + esc(al.week ? C.fmtShort(al.week[0]) + ' to ' + C.fmtShort(al.week[1]) : '') + ' from ' + esc(al.source) + '</summary><div class="alab__grid">' +
      (team.length ? '<section><h3>Teammates</h3><dl class="alab__team">' + team.map(([who, items]) => '<div><dt>' + esc(who) + '</dt><dd>' + items.map(esc).join('<br>') + '</dd></div>').join('') + '</dl></section>' : '') +
      (al.questions && al.questions.length ? '<section><h3>Sponsor answers</h3><dl class="alab__team">' + al.questions.map((q) => '<div><dt>' + esc(q.q) + '</dt><dd>' + esc(q.a) + '</dd></div>').join('') + '</dl></section>' : '') +
      (next.length ? '<section><h3>Milestones</h3><dl class="alab__team">' + next.map((m) => '<div><dt>' + esc(C.fmtShort(m.date)) + '</dt><dd>' + esc(m.title) + '</dd></div>').join('') + '</dl></section>' : '') +
      (al.weekly && al.weekly.length ? '<section><h3>Team checklist</h3><ul class="alab__list">' + al.weekly.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></section>' : '') +
      (al.files && al.files.length ? '<section><h3>In the A-Lab folder, newest first</h3><dl class="alab__team alab__files">' + al.files.slice(0, 10).map((f) => '<div><dt>' + esc(C.fmtShort(f.date)) + '</dt><dd>' + esc(f.file) + ' <span class="muted">' + esc(f.kind) + '</span></dd></div>').join('') + '</dl></section>' : '') +
      '</div><p class="qactions"><button class="btn btn--sm" type="button" id="alabDraft">' + C.icon.spark + ' Draft next week\u2019s update with Claude</button></p></details>';
  }

  function edit(el, opts, li, x) {
    li.innerHTML = '<span></span><form class="tedit"><label class="visually-hidden" for="te-' + esc(x.id) + '">Task</label><input id="te-' + esc(x.id) + '" type="text" name="title" value="' + esc(x.title) + '" autocomplete="off">' +
      '<label class="visually-hidden" for="td-' + esc(x.id) + '">Due date</label><input id="td-' + esc(x.id) + '" type="date" name="due" value="' + esc(x.due || '') + '">' +
      '<button class="btn btn--sm btn--primary" type="submit">Save</button><button class="btn btn--sm btn--quiet" type="button" data-cancel>Cancel</button></form><span></span>';
    const f = li.querySelector('form');
    const inp = f.querySelector('input');
    inp.focus();
    inp.select();
    f.querySelector('[data-cancel]').onclick = () => tasks.mount(el, opts);
    f.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); tasks.mount(el, opts); } };
    f.onsubmit = (e) => {
      e.preventDefault();
      const title = f.elements.title.value.trim();
      if (!title) { inp.setAttribute('aria-invalid', 'true'); return; }
      const due = f.elements.due.value || null;
      tasks.patch((s) => {
        const c = s.custom.find((y) => y.id === x.id);
        if (c) { c.title = title; c.due = due; } else s.edits[x.id] = { title, due };
      });
      tasks.mount(el, opts);
      C.emit('tasks', el);
    };
  }

  function row(x, t, header) {
    const late = x.due && x.due < t && !x.doneAt;
    const dueTxt = x.due ? (x.due === t ? 'Today' : x.due === C.addDays(t, 1) ? 'Tomorrow' : C.fmtShort(x.due)) + (x.time ? ', ' + C.fmtTime(x.time) : '') : 'No date';
    return (header ? '<li class="tdiv" aria-hidden="true">' + tasks.group(x, t) + '</li>' : '') +
      '<li class="task c-' + x.course + (x.doneAt ? ' is-done' : '') + '" data-id="' + esc(x.id) + '">' +
      '<button class="check" type="button" role="checkbox" aria-checked="' + !!x.doneAt + '" aria-label="' + esc((x.doneAt ? 'Mark not done: ' : 'Mark done: ') + x.title) + '">' + C.icon.check + '</button>' +
      '<div class="task__body"><span class="task__title">' + (x.flag ? '<span class="flagmark" role="img" aria-label="Priority">' + C.icon.flag + '</span>' : '') + (x.link ? '<a href="' + x.link + '">' + esc(x.title) + '</a>' : x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener" title="Open in Canvas">' + esc(x.title) + '</a>' : esc(x.title)) + '</span>' +
      (x.detail ? '<details class="task__detail"><summary>From your note</summary><p>' + esc(x.detail) + '</p></details>' : '') +
      '<span class="task__meta"><span class="ctag">' + esc(C.data.courseName(x.course)) + '</span><span class="due' + (late ? ' is-late' : x.due === t ? ' is-today' : '') + '">' + esc(dueTxt) + '</span><span>' + esc(x.src) + '</span></span></div>' +
      '<div class="task__tools">' +
      (x.review ? '<button class="iconbtn" type="button" data-review="' + esc(x.id) + '" aria-label="Review this with Claude" title="Review with Claude">' + C.icon.chat + '</button>' : '') +
      '<button class="iconbtn" type="button" data-flag="' + esc(x.id) + '" aria-pressed="' + x.flag + '" aria-label="' + (x.flag ? 'Remove priority flag' : 'Flag as priority') + '" title="Priority">' + C.icon.flag + '</button>' +
      (x.doneAt ? '' : '<button class="iconbtn" type="button" data-edit="' + esc(x.id) + '" aria-label="Edit task" title="Edit">' + C.icon.edit + '</button>') +
      (x.custom ? '<button class="iconbtn" type="button" data-del="' + esc(x.id) + '" aria-label="Delete task" title="Delete">' + C.icon.trash + '</button>' : '<button class="iconbtn" type="button" data-hide="' + esc(x.id) + '" aria-label="Hide task" title="Hide">' + C.icon.x + '</button>') +
      '</div></li>';
  }
  // FLIP: let checked rows glide to their new place instead of jumping
  function rects(el) { const m = {}; $$('.task', el).forEach((li) => (m[li.dataset.id] = li.getBoundingClientRect().top)); return m; }
  function flip(el, before) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    $$('.task', el).forEach((li) => {
      const b = before[li.dataset.id];
      if (b == null) return;
      const dy = b - li.getBoundingClientRect().top;
      if (!dy) return;
      li.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    });
  }

  C.routes.tasks = {
    title: 'Tasks',
    render(main) {
      main.innerHTML = '<div class="page page--narrow"><div class="phead"><div><h1>Tasks</h1><p>Deadlines from your planner, your A-Lab goals from the newest weekly-update deck, exam prep, and anything you add.</p></div></div><div id="taskMount"></div></div>';
      if (tasks.ui && tasks.ui.page) tasks.ui.page.course = C.route.q.c || 'all';
      tasks.mount($('#taskMount'), {});
    },
  };
  C.on('tasks', (src) => {
    const pane = $('#paneTasks'), page = $('#taskMount');
    if (C.drawer && C.drawer.pane === 'tasks' && C.drawer.isOpen() && pane !== src) tasks.mount(pane, { compact: true });
    if (C._lastView === 'tasks' && page && page !== src) tasks.mount(page, {});
    if (C._lastView === 'today' && C.routes.today.refreshTasks) C.routes.today.refreshTasks();
  });
})();
