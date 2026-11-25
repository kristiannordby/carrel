/* Deadlines model (planner + A-Lab decks + your own) and the Calendar view: month grid, agenda, course filter. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;

  // ------------------------------------------------------------ the one list of dated things
  C.deadlines = function () {
    const v = C.data.vault();
    const out = (v.planner.deadlines || []).map((d) => Object.assign({}, d));
    (v.alab && v.alab.milestones ? v.alab.milestones : []).forEach((m) => out.push({ id: 'al-' + m.date, date: m.date, time: null, title: 'A-Lab milestone: ' + m.title, course: 'alab', priority: 'Medium', major: false, notes: 'From ' + m.from + '.', kind: 'milestone', src: 'alab' }));
    (C.store.get('events', []) || []).forEach((e) => out.push(Object.assign({ kind: 'due', src: 'me', priority: 'Medium' }, e)));
    return out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  };
  C.classesOn = function (iso) {
    const v = C.data.vault();
    const dow = (C.parse(iso).getDay() + 6) % 7; // Mon = 0
    const out = [];
    (v.planner.schedule || []).forEach((s) => {
      if (iso < s.from || iso > s.until || !s.days.includes(dow)) return;
      if ((v.planner.noClass || ['2026-11-26', '2026-11-27']).includes(iso)) return;
      out.push({ course: s.course, title: s.what, start: s.start, end: s.end, loc: s.loc, kind: 'class' });
    });
    (v.planner.sessions || []).filter((s) => s.date === iso).forEach((s) => out.push({ course: s.course, title: s.title, start: s.start, end: s.end, loc: s.loc, kind: 'class', special: true }));
    return out.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  };
  C.isDone = (id) => !!(C.store.get('tasks', {}).done || {})[id];

  const COURSE_IDS = ['c57', '095', '072', 'alab', 'faa', 'hodl', 'me'];

  C.routes.calendar = {
    title: 'Calendar',
    render(main, r) {
      const t = C.today();
      if (r.parts[0] === 'week' || (!r.parts[0] && C.store.get('calView') === 'week')) return renderWeek(main, r);
      C.store.set('calView', 'month');
      const month = r.parts[0] && /^\d{4}-\d{2}$/.test(r.parts[0]) ? r.parts[0] : t.slice(0, 7);
      const hidden = (r.q.hide || '').split(',').filter(Boolean);
      const showClasses = r.q.classes === '1';
      const hasOutlook = !!(C.sync && C.sync.outlook && C.sync.outlook.events);
      const showOutlook = hasOutlook && r.q.outlook !== '0';
      const olOn = (iso) => (showOutlook ? C.sync.eventsOn(iso) : []);
      const all = C.deadlines().filter((d) => !hidden.includes(d.course || 'me'));
      const [y, m] = month.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const start = C.addDays(C.iso(first), -first.getDay()); // weeks run Sunday to Saturday
      const prev = C.iso(new Date(y, m - 2, 1)).slice(0, 7), next = C.iso(new Date(y, m, 1)).slice(0, 7);
      const vault = C.data.vault();

      let grid = C.DOW.map((d) => '<div class="month__dow">' + d + '</div>').join('');
      for (let k = 0; k < 42; k++) {
        const iso = C.addDays(start, k);
        if (k === 35 && iso.slice(0, 7) !== month) break;
        const dd = C.parse(iso);
        const evs = all.filter((d) => d.date === iso);
        const cls = showClasses ? C.classesOn(iso).filter((x) => !hidden.includes(x.course)) : [];
        grid += '<div class="day' + (iso.slice(0, 7) !== month ? ' is-out' : '') + (iso === t ? ' is-today' : '') + (dd.getDay() % 6 === 0 ? ' is-weekend' : '') + '"' + (iso === t ? ' aria-current="date"' : '') + '>' +
          '<span class="day__n">' + dd.getDate() + '</span>' +
          evs.map((d) => '<button type="button" class="ev c-' + (d.course || 'me') + (d.kind === 'exam' ? ' is-exam' : '') + (C.isDone(d.id) ? ' is-done' : '') + '" data-id="' + esc(d.id) + '" title="' + esc(C.data.courseName(d.course) + ': ' + d.title) + '" aria-label="' + esc(C.fmtLong(d.date) + ', ' + C.data.courseName(d.course) + ': ' + d.title) + '">' + esc(d.title.replace(/^A-Lab milestone: /, '')) + '</button>').join('') +
          cls.map((x) => '<span class="ev is-class c-' + x.course + '" title="' + esc(C.data.courseName(x.course) + ' ' + x.title + ', ' + C.fmtTime(x.start) + ' to ' + C.fmtTime(x.end) + ', ' + x.loc) + '">' + esc(C.fmtTime(x.start) + ' ' + (C.data.course(x.course) || {}).short) + '</span>').join('') +
          olOn(iso).map((e) => '<a class="ev is-outlook" href="' + esc(e.url || '#') + '" target="_blank" rel="noopener" title="' + esc('Outlook: ' + e.title + (e.allDay ? ', all day' : e.start ? ', ' + C.fmtTime(e.start) + (e.end ? ' to ' + C.fmtTime(e.end) : '') : '') + (e.loc ? ', ' + e.loc : '')) + '">' + esc((e.start ? C.fmtTime(e.start) + ' ' : '') + e.title) + '</a>').join('') +
          '</div>';
      }
      // agenda: next 14 days
      let agenda = '';
      for (let k = 0; k < 14; k++) {
        const iso = C.addDays(t, k);
        const evs = all.filter((d) => d.date === iso);
        const cls = C.classesOn(iso).filter((x) => !hidden.includes(x.course));
        const ol = olOn(iso);
        if (!evs.length && !cls.length && !ol.length) continue;
        agenda += '<div class="agenda__day"><h3' + (k === 0 ? ' class="is-today"' : '') + '>' + (k === 0 ? 'Today, ' : k === 1 ? 'Tomorrow, ' : '') + esc(C.fmtShort(iso)) + '</h3>' +
          evs.map((d) => '<div class="aitem c-' + (d.course || 'me') + '"><time>' + (d.time ? C.fmtTime(d.time) : 'due') + '</time><div><button class="linkbtn" type="button" data-id="' + esc(d.id) + '"><b>' + esc(d.title) + '</b></button><div class="ctag">' + esc(C.data.courseName(d.course)) + '</div>' + (d.moved ? '<div class="moved">Moved from ' + esc(C.fmtShort(d.moved.from)) + '</div>' : '') + '</div></div>').join('') +
          cls.map((x) => '<div class="aitem is-class c-' + x.course + '"><time>' + C.fmtTime(x.start) + '</time><div>' + esc((C.data.course(x.course) || {}).short + ' ' + x.title.toLowerCase()) + ', ' + esc(x.loc) + '</div></div>').join('') +
          ol.map((e) => '<div class="aitem is-outlook"><time>' + (e.start ? C.fmtTime(e.start) : 'all day') + '</time><div><a href="' + esc(e.url || '#') + '" target="_blank" rel="noopener">' + esc(e.title) + '</a>' + (e.loc ? '<div class="muted">' + esc(e.loc) + '</div>' : '') + '</div></div>').join('') +
          '</div>';
      }
      main.innerHTML =
        '<div class="page">' +
        '<div class="phead"><div><h1>' + C.MONL[m - 1] + ' ' + y + '</h1><p>Deadlines from planner.md' + (vault.alab && vault.alab.source ? ', A-Lab milestones from ' + esc(vault.alab.source) : '') + ', and anything you add.</p></div>' +
        '<div class="phead__tools">' + viewSwitch('month', t) + '<a class="btn" href="#/calendar/' + prev + esc(location.hash.replace(/^[^?]*/, '')) + '" aria-label="Previous month">' + C.icon.left + '</a>' +
        '<a class="btn" href="#/calendar/' + t.slice(0, 7) + esc(location.hash.replace(/^[^?]*/, '')) + '">Today</a>' +
        '<a class="btn" href="#/calendar/' + next + esc(location.hash.replace(/^[^?]*/, '')) + '" aria-label="Next month">' + C.icon.right + '</a>' +
        '<a class="btn" href="#/grades">Grades</a><button class="btn" type="button" id="exportIcs">Export .ics</button><button class="btn btn--primary" type="button" id="addEvent">Add deadline</button></div></div>' +
        '<div class="filters cal__legend" role="group" aria-label="Show courses">' +
        COURSE_IDS.map((id) => '<button class="chip c-' + id + '" type="button" data-c="' + id + '" aria-pressed="' + !hidden.includes(id) + '">' + esc(C.data.courseName(id)) + '</button>').join('') +
        '<span class="sep" aria-hidden="true"></span><button class="chip" type="button" id="toggleClasses" aria-pressed="' + showClasses + '">Class times</button>' +
        (hasOutlook ? '<button class="chip chip--outlook" type="button" id="toggleOutlook" aria-pressed="' + showOutlook + '">Outlook</button>' : '') + '</div>' +
        '<div class="cal mt-lg"><div class="month" role="group" aria-label="' + C.MONL[m - 1] + ' ' + y + '">' + grid + '</div>' +
        '<aside class="agenda" aria-label="Next two weeks"><h2>Next two weeks</h2>' + (agenda || '<p class="muted">Nothing scheduled.</p>') + '</aside></div></div>';
      $$('[data-c]', main).forEach((b) => (b.onclick = () => {
        const h = hidden.slice(); const i = h.indexOf(b.dataset.c); if (i >= 0) h.splice(i, 1); else h.push(b.dataset.c);
        C.setQuery({ hide: h.join(',') }); C.render();
      }));
      $('#toggleClasses').onclick = () => { C.setQuery({ classes: showClasses ? '' : '1' }); C.render(); };
      if ($('#toggleOutlook')) $('#toggleOutlook').onclick = () => { C.setQuery({ outlook: showOutlook ? '0' : '' }); C.render(); };
      $$('[data-id]', main).forEach((b) => (b.onclick = (e) => pop(e.currentTarget, b.dataset.id)));
      $('#addEvent').onclick = () => addEvent();
      $('#exportIcs').onclick = exportIcs;
    },
  };

  function viewSwitch(cur, t) {
    const mon = C.addDays(t, -C.parse(t).getDay());
    return '<div class="seg" role="group" aria-label="Calendar view"><a class="segbtn" role="button" aria-pressed="' + (cur === 'month') + '" href="#/calendar/' + t.slice(0, 7) + '">Month</a><a class="segbtn" role="button" aria-pressed="' + (cur === 'week') + '" href="#/calendar/week/' + mon + '">Week</a></div>';
  }

  // ------------------------------------------------------------ week: an hour grid, classes as blocks, deadlines on top
  const H0 = 7, H1 = 22;
  function renderWeek(main, r) {
    C.store.set('calView', 'week');
    const t = C.today();
    let mon = /^\d{4}-\d{2}-\d{2}$/.test(r.parts[1] || '') ? r.parts[1] : t;
    mon = C.addDays(mon, -C.parse(mon).getDay()); // the Sunday that starts the week
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => C.addDays(mon, k));
    const hidden = (r.q.hide || '').split(',').filter(Boolean);
    const all = C.deadlines().filter((d) => !hidden.includes(d.course || 'me'));
    const hr = 48;
    const min = (x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
    const y = (x) => ((min(x) - H0 * 60) / 60) * hr;
    const hours = [];
    for (let h = H0; h < H1; h++) hours.push(h);
    const now = new Date();
    const nowY = ((now.getHours() * 60 + now.getMinutes() - H0 * 60) / 60) * hr;
    const head = days.map((d) => '<div class="wk__dh' + (d === t ? ' is-today' : '') + '"><span>' + C.DOW[C.parse(d).getDay()] + '</span><b>' + C.parse(d).getDate() + '</b></div>').join('');
    const olDay = (d) => (C.sync && C.sync.outlook ? C.sync.eventsOn(d) : []);
    const allday = days.map((d) => '<div class="wk__ad">' + olDay(d).filter((e) => e.allDay || e.cont).map((e) => '<a class="ev is-outlook" href="' + esc(e.url || '#') + '" target="_blank" rel="noopener" title="' + esc('Outlook: ' + e.title) + '">' + esc(e.title) + '</a>').join('') + all.filter((x) => x.date === d).map((x) => '<button type="button" class="ev c-' + (x.course || 'me') + (x.kind === 'exam' ? ' is-exam' : '') + (C.isDone(x.id) ? ' is-done' : '') + '" data-id="' + esc(x.id) + '" title="' + esc(C.data.courseName(x.course) + ': ' + x.title + (x.time ? ', ' + C.fmtTime(x.time) : '')) + '">' + (x.time ? C.fmtTime(x.time) + ' ' : '') + esc(x.title) + '</button>').join('') + '</div>').join('');
    const cols = days.map((d) => {
      const blocks = C.classesOn(d).filter((x) => !hidden.includes(x.course) && x.start).map((x) => {
        const top = Math.max(0, y(x.start)), h = Math.max(22, y(x.end || x.start) - y(x.start));
        return '<div class="wk__blk c-' + x.course + (x.special ? ' is-special' : '') + '" style="top:' + top + 'px;height:' + h + 'px" title="' + esc(C.data.courseName(x.course) + ' ' + x.title + ', ' + C.fmtTime(x.start) + ' to ' + C.fmtTime(x.end) + ', ' + x.loc) + '"><b>' + esc((C.data.course(x.course) || {}).short) + '</b><span>' + esc(x.title) + '</span><span>' + esc(C.fmtTime(x.start) + ', ' + x.loc) + '</span></div>';
      }).join('');
      const ol = olDay(d).filter((e) => !e.allDay && !e.cont && e.start).map((e) => {
        const top = Math.max(0, y(e.start)), h = Math.max(22, (e.end && e.endDate === e.date ? y(e.end) : (H1 - H0) * hr) - y(e.start));
        return '<a class="wk__blk is-outlook" href="' + esc(e.url || '#') + '" target="_blank" rel="noopener" style="top:' + top + 'px;height:' + h + 'px" title="' + esc('Outlook: ' + e.title + ', ' + C.fmtTime(e.start) + (e.end ? ' to ' + C.fmtTime(e.end) : '') + (e.loc ? ', ' + e.loc : '')) + '"><b>' + esc(e.title) + '</b><span>' + esc(C.fmtTime(e.start) + (e.loc ? ', ' + e.loc : '')) + '</span></a>';
      }).join('');
      const marks = all.filter((x) => x.date === d && x.time && min(x.time) >= H0 * 60 && min(x.time) < H1 * 60).map((x) => '<div class="wk__due c-' + (x.course || 'me') + '" style="top:' + y(x.time) + 'px" title="' + esc(x.title + ' due ' + C.fmtTime(x.time)) + '"><span>' + esc(C.fmtTime(x.time) + ' ' + x.title) + '</span></div>').join('');
      return '<div class="wk__col' + (d === t ? ' is-today' : '') + '">' + blocks + ol + marks + (d === t && nowY > 0 && nowY < (H1 - H0) * hr ? '<div class="wk__now" style="top:' + nowY + 'px" aria-hidden="true"></div>' : '') + '</div>';
    }).join('');
    main.innerHTML =
      '<div class="page"><div class="phead"><div><h1>Week of ' + esc(C.MONL[C.parse(mon).getMonth()] + ' ' + C.parse(mon).getDate()) + '</h1><p>Classes from the planner\u2019s schedule, deadlines along the top.</p></div>' +
      '<div class="phead__tools">' + viewSwitch('week', t) +
      '<a class="btn" href="#/calendar/week/' + C.addDays(mon, -7) + '" aria-label="Previous week">' + C.icon.left + '</a>' +
      '<a class="btn" href="#/calendar/week/' + C.addDays(t, -C.parse(t).getDay()) + '">This week</a>' +
      '<a class="btn" href="#/calendar/week/' + C.addDays(mon, 7) + '" aria-label="Next week">' + C.icon.right + '</a>' +
      '<button class="btn" type="button" id="exportIcs">Export .ics</button></div></div>' +
      '<div class="wk" style="--hr:' + hr + 'px"><div class="wk__corner"></div>' + head + '<div class="wk__corner wk__adl">Due</div>' + allday +
      '<div class="wk__hours">' + hours.map((h) => '<span>' + (h % 12 || 12) + '\u2009' + (h < 12 ? 'am' : 'pm') + '</span>').join('') + '</div>' + cols + '</div></div>';
    $$('[data-id]', main).forEach((b) => (b.onclick = (e) => pop(e.currentTarget, b.dataset.id)));
    $('#exportIcs').onclick = exportIcs;
    const scroller = $('.wk', main);
    const inWeek = days.includes(t) && now.getHours() >= 8 && now.getHours() < 20;
    if (scroller) scroller.scrollTop = inWeek ? Math.max(0, nowY - 160) : 0;
  }

  // ------------------------------------------------------------ .ics export: deadlines plus weekly classes
  function exportIcs() {
    const v = C.data.vault();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const d8 = (iso) => iso.replace(/-/g, '');
    const tm = (x) => x.replace(':', '') + '00';
    const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\r?\n|\r/g, '\\n');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Carrel//MBAn//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:MBAn (Carrel)',
      'BEGIN:VTIMEZONE', 'TZID:America/New_York',
      'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
      'END:VTIMEZONE'];
    const noClass = v.planner.noClass || ['2026-11-26', '2026-11-27'];
    C.deadlines().forEach((d) => {
      L.push('BEGIN:VEVENT', 'UID:' + d.id + '@carrel', 'DTSTAMP:' + stamp, 'SUMMARY:' + escI(C.data.courseName(d.course) + ': ' + d.title));
      if (d.time) L.push('DTSTART;TZID=America/New_York:' + d8(d.date) + 'T' + tm(d.time), 'DURATION:PT30M');
      else L.push('DTSTART;VALUE=DATE:' + d8(d.date), 'DTEND;VALUE=DATE:' + d8(C.addDays(d.date, 1)));
      if (d.notes) L.push('DESCRIPTION:' + escI(d.notes));
      L.push('END:VEVENT');
    });
    const BY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    (v.planner.schedule || []).forEach((sl, i) => {
      if (!sl.days || !sl.days.length || !sl.start) return;
      // first meeting on or after the term start
      let first = sl.from;
      for (let g = 0; g < 7 && !sl.days.includes((C.parse(first).getDay() + 6) % 7); g++) first = C.addDays(first, 1);
      const skips = noClass.filter((x) => sl.days.includes((C.parse(x).getDay() + 6) % 7));
      L.push('BEGIN:VEVENT', 'UID:class-' + sl.course + '-' + i + '@carrel', 'DTSTAMP:' + stamp,
        'SUMMARY:' + escI(C.data.courseName(sl.course) + ' ' + sl.what.toLowerCase()), 'LOCATION:' + escI(sl.loc),
        'DTSTART;TZID=America/New_York:' + d8(first) + 'T' + tm(sl.start), 'DTEND;TZID=America/New_York:' + d8(first) + 'T' + tm(sl.end),
        'RRULE:FREQ=WEEKLY;BYDAY=' + sl.days.map((k) => BY[k]).join(',') + ';UNTIL=' + d8(sl.until) + 'T235959Z',
        ...(skips.length ? ['EXDATE;TZID=America/New_York:' + skips.map((x) => d8(x) + 'T' + tm(sl.start)).join(',')] : []), 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    const a = document.createElement('a');
    // fold lines at 75 octets, as RFC 5545 asks
    const fold = (line) => { const out = []; let cur = ''; for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; } cur += ch; } out.push(cur); return out.join('\r\n '); };
    a.href = URL.createObjectURL(new Blob([L.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar' }));
    a.download = 'mban-fall-2026.ics';
    a.click();
    C.toast('Saved mban-fall-2026.ics. Import it into Outlook or Google Calendar.');
  }

  // ------------------------------------------------------------ event popover
  function closePop() { const p = $('.evpop'); if (p) p.remove(); document.removeEventListener('mousedown', outside); }
  function outside(e) { if (!e.target.closest('.evpop') && !e.target.closest('[data-id]')) closePop(); }
  function pop(anchor, id) {
    closePop();
    const d = C.deadlines().find((x) => x.id === id);
    if (!d) return;
    const c = C.data.course(d.course);
    const units = C.study && d.kind === 'exam' ? C.study.examUnits(d) : [];
    const m = units.length ? C.study.courseMastery(d.course, units) : null;
    const el = document.createElement('div');
    el.className = 'evpop c-' + (d.course || 'me');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', d.title);
    el.innerHTML =
      '<h3>' + esc(d.title) + '</h3>' +
      '<dl><dt>When</dt><dd>' + esc(C.fmtLong(d.date)) + (d.time ? ', ' + C.fmtTime(d.time) : '') + ' (' + C.rel(d.date) + ')</dd>' +
      '<dt>Course</dt><dd><span class="ctag">' + esc(c ? c.code + ' ' + c.short : 'Personal') + '</span></dd>' +
      (d.priority ? '<dt>Priority</dt><dd>' + esc(d.priority) + '</dd>' : '') +
      (m ? '<dt>Ready</dt><dd>' + m.right + ' of ' + m.total + ' questions right</dd>' : '') + '</dl>' +
      (d.moved ? '<p class="moved">' + esc(d.moved.note) + ' planner.md still shows the old date.</p>' : '') +
      (d.notes ? '<p>' + esc(d.notes) + '</p>' : '') +
      (d.canvas && d.canvas.date !== d.date ? '<p class="moved">Canvas has it due ' + esc(C.fmtShort(d.canvas.date) + (d.canvas.time ? ' at ' + C.fmtTime(d.canvas.time) : '')) + '. Check which date is right.</p>' : '') +
      '<div class="qactions">' +
      (d.url || d.canvas ? '<a class="btn btn--sm" href="' + esc(d.url || d.canvas.url) + '" target="_blank" rel="noopener">Open in Canvas</a>' : '') +
      (units.length ? '<a class="btn btn--sm btn--primary" href="#/study/' + d.course + '/exam/quiz?units=' + units.join(',') + '">Drill for it</a><a class="btn btn--sm" href="#/sheet/' + d.course + '?units=' + units.join(',') + '">Review sheet</a>' : '') +
      '<button class="btn btn--sm" type="button" data-done>' + (C.isDone(d.id) ? 'Mark not done' : 'Mark done') + '</button>' +
      (d.src === 'me' ? '<button class="btn btn--sm btn--quiet" type="button" data-del>Delete</button>' : '') + '</div>';
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.max(12, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 12)) + 'px';
    el.style.top = (window.scrollY + r.bottom + 6) + 'px';
    el.querySelector('[data-done]').onclick = () => { C.tasks.toggle(d.id); closePop(); C.render(); };
    const del = el.querySelector('[data-del]');
    if (del) del.onclick = () => {
      const before = C.store.get('events', []);
      C.store.set('events', before.filter((x) => x.id !== d.id));
      closePop(); C.render();
      C.toast('Deadline deleted.', { label: 'Undo', fn: () => { C.store.set('events', before); C.render(); } });
    };
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); anchor.focus(); } });
    const f = el.querySelector('a, button');
    f && f.focus();
  }

  function addEvent() {
    const dlg = $('#settings');
    dlg.innerHTML =
      '<form method="dialog" id="evForm"><div class="modal__head"><h2 id="settingsTitle">Add a deadline</h2></div><div class="modal__body">' +
      '<label class="field">What<input type="text" name="title" required autocomplete="off"></label>' +
      '<div class="grid2"><label class="field">Due<input type="date" name="date" required value="' + C.today() + '"></label><label class="field">Time (optional)<input type="time" name="time"></label></div>' +
      '<label class="field">Course<select name="course">' + COURSE_IDS.map((id) => '<option value="' + id + '">' + esc(C.data.courseName(id)) + '</option>').join('') + '</select></label>' +
      '<label class="field">Notes<input type="text" name="notes" autocomplete="off"></label>' +
      '</div><div class="modal__foot"><button class="btn" value="cancel" type="submit" formnovalidate>Cancel</button><button class="btn btn--primary" value="ok" type="submit">Add deadline</button></div></form>';
    dlg.showModal();
    const f = $('#evForm');
    f.onsubmit = (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const fd = new FormData(f);
      if (!fd.get('title').trim()) { e.preventDefault(); return; }
      C.store.update('events', [], (list) => { list.push({ id: 'me-' + C.uid(), date: fd.get('date'), time: fd.get('time') || null, title: fd.get('title').trim(), course: fd.get('course'), notes: fd.get('notes') }); });
      setTimeout(C.render, 0);
    };
  }
})();
