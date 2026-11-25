/* Focus timer in the top bar (25 or 50 minutes), tied to whatever you are studying; logs minutes per day.
   Also the activity heatmap and streak used on Today. */
(function () {
  'use strict';
  const C = window.C;
  const { $, esc } = C;
  const focus = (C.focus = {});

  const state = () => C.store.get('focusTimer', null);
  function log(mins, what) {
    if (mins < 1) return;
    C.store.update('focus', {}, (f) => { const d = C.today(); f[d] = (f[d] || 0) + Math.round(mins); f._t = Date.now(); });
    C.store.update('focusLog', [], (l) => { l.push({ at: Date.now(), mins: Math.round(mins), what }); return l.slice(-300); });
  }
  function what() {
    const r = C.route;
    if (r.view === 'study' && r.parts[0]) {
      const u = C.data.unit(r.parts[0], r.parts[1]);
      return C.data.courseName(r.parts[0]) + (u ? ' ' + u.label : '');
    }
    return 'Focus';
  }
  focus.start = function (mins) {
    C.store.set('focusTimer', { ends: Date.now() + mins * 60000, mins, what: what(), paused: null });
    draw();
  };
  focus.stop = function (complete) {
    const s = state();
    if (!s) return;
    const left = s.paused ? s.left : Math.max(0, s.ends - Date.now());
    const elapsed = s.mins - left / 60000;
    log(complete ? s.mins : elapsed, s.what);
    C.store.set('focusTimer', null);
    draw();
    if (complete) {
      C.toast('Focus block done: ' + s.mins + ' min on ' + s.what + '. Take five.');
      try { if (window.Notification && Notification.permission === 'granted') new Notification('Carrel', { body: s.mins + ' minutes on ' + s.what + ' done.' }); } catch (e) {}
    }
    if (C._lastView === 'today') C.render();
  };
  focus.toggle = function () {
    const s = state();
    if (!s) return;
    if (s.paused) { s.ends = Date.now() + s.left; s.paused = null; s.left = null; }
    else { s.left = s.ends - Date.now(); s.paused = Date.now(); }
    C.store.set('focusTimer', s);
    draw();
  };

  function draw() {
    const btn = $('#focusBtn');
    if (!btn) return;
    const s = state();
    if (!s) { btn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><circle cx="10" cy="11" r="6.5"/><path d="M10 11V7.5M8 2.5h4"/></svg>'; btn.classList.remove('is-running'); btn.setAttribute('aria-label', 'Start a focus block'); btn.title = 'Focus timer'; return; }
    const ms = s.paused ? s.left : s.ends - Date.now();
    if (ms <= 0 && !s.paused) { focus.stop(true); return; }
    const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
    btn.classList.add('is-running');
    btn.textContent = m + ':' + String(sec).padStart(2, '0');
    btn.setAttribute('aria-label', btn.textContent + ' focus timer' + (s.paused ? ', paused' : '') + ', open controls');
    btn.title = s.what + (s.paused ? ' (paused)' : '');
    btn.classList.toggle('is-paused', !!s.paused);
  }
  function menu() {
    const old = $('.focusmenu');
    if (old) { old.remove(); return; }
    const s = state();
    const el = document.createElement('div');
    el.className = 'evpop focusmenu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Focus timer');
    el.innerHTML = s
      ? '<h3>' + esc(s.what) + '</h3><p>' + (s.paused ? 'Paused.' : 'Running.') + ' Minutes count toward today’s study time.</p><div class="qactions"><button class="btn btn--sm" type="button" data-a="toggle">' + (s.paused ? 'Resume' : 'Pause') + '</button><button class="btn btn--sm" type="button" data-a="stop">Stop and log</button></div>'
      : '<h3>Focus block</h3><p>Studying ' + esc(what()) + '. The timer runs in the bar while you move around.</p><div class="qactions"><button class="btn btn--sm btn--primary" type="button" data-a="25">25 min</button><button class="btn btn--sm" type="button" data-a="50">50 min</button></div>';
    document.body.appendChild(el);
    const r = $('#focusBtn').getBoundingClientRect();
    el.style.left = Math.max(12, window.scrollX + r.right - 320) + 'px';
    el.style.top = (window.scrollY + r.bottom + 8) + 'px';
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      const v = a.dataset.a;
      if (v === 'toggle') focus.toggle(); else if (v === 'stop') focus.stop(false); else { focus.start(+v); try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (err) {} }
      el.remove();
    });
    const off = (e) => { if (!e.target.closest('.focusmenu') && !e.target.closest('#focusBtn')) { el.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    const f = el.querySelector('button');
    f && f.focus();
  }

  // ------------------------------------------------------------ activity (answers + focus minutes per day)
  focus.activity = function (weeks) {
    const a = C.store.get('activity', {}), f = C.store.get('focus', {});
    const t = C.today();
    const end = C.addDays(t, 6 - C.parse(t).getDay()); // through this Saturday: weeks run Sunday to Saturday
    const start = C.addDays(end, -(weeks * 7) + 1);
    const days = [];
    for (let d = start; d <= end; d = C.addDays(d, 1)) days.push({ d, n: a[d] || 0, m: f[d] || 0, future: d > t });
    let streak = 0;
    for (let d = t; ; d = C.addDays(d, -1)) { if ((a[d] || 0) + (f[d] || 0) > 0) streak++; else if (d !== t) break; else continue; if (streak > 400) break; }
    const wk = days.filter((x) => x.d > C.addDays(t, -7) && x.d <= t);
    return { days, streak, weekAnswers: wk.reduce((s, x) => s + x.n, 0), weekMinutes: wk.reduce((s, x) => s + x.m, 0) };
  };
  focus.heatmap = function () {
    const act = focus.activity(12);
    const score = (x) => x.n + x.m * 2;
    const max = Math.max(1, ...act.days.map(score));
    const lvl = (x) => (x.future ? -1 : score(x) === 0 ? 0 : Math.min(4, 1 + Math.floor((score(x) / max) * 3.999)));
    const cols = [];
    for (let w = 0; w < 12; w++) cols.push(act.days.slice(w * 7, w * 7 + 7));
    return '<div class="heat"><div class="heat__grid" role="img" aria-label="Study activity, last 12 weeks. ' + act.weekAnswers + ' answers and ' + act.weekMinutes + ' focused minutes in the last 7 days.">' +
      cols.map((col) => '<div class="heat__col">' + col.map((x) => '<i class="l' + lvl(x) + '" title="' + esc(C.fmtShort(x.d) + ': ' + x.n + ' answers, ' + x.m + ' min focused') + '"></i>').join('') + '</div>').join('') +
      '</div><dl class="stats"><div><dt>Streak</dt><dd>' + act.streak + (act.streak === 1 ? ' day' : ' days') + '</dd></div><div><dt>Answers, 7 days</dt><dd>' + act.weekAnswers + '</dd></div><div><dt>Focused, 7 days</dt><dd>' + act.weekMinutes + ' min</dd></div></dl>' + week() + '</div>';
  };
  // the week in a line: accuracy, sleep and tasks closed over the last seven days, each only when there is data
  function week() {
    const t = C.today(), from = C.addDays(t, -6);
    const log = (C.store.get('answerLog', []) || []).filter((x) => x[0] >= from && x[0] <= t);
    const rec = C.store.get('recovery', {}) || {};
    const nights = Object.keys(rec.sleep || {}).filter((d) => d >= from && d <= t).map((d) => C.recovery.hours(rec.sleep[d])).filter((h) => h != null);
    const done = Object.values((C.store.get('tasks', {}) || {}).done || {}).filter((ts) => ts > Date.now() - 7 * 864e5).length;
    const bits = [];
    if (log.length) bits.push('<div><dt>Right, 7 days</dt><dd>' + Math.round((100 * log.filter((x) => x[2]).length) / log.length) + '%</dd></div>');
    if (nights.length) bits.push('<div><dt>Sleep, ' + nights.length + '-night average</dt><dd>' + (nights.reduce((a, b) => a + b, 0) / nights.length).toFixed(1) + ' h</dd></div>');
    if (done) bits.push('<div><dt>Tasks done, 7 days</dt><dd>' + done + '</dd></div>');
    return bits.length ? '<dl class="stats">' + bits.join('') + '</dl>' : '';
  }

  C.on('boot', () => {
    const tools = $('.bar__tools');
    const b = document.createElement('button');
    b.className = 'iconbtn focusbtn';
    b.type = 'button';
    b.id = 'focusBtn';
    tools.insertBefore(b, tools.firstChild);
    b.onclick = () => { menu(); b.setAttribute('aria-expanded', String(!!$('.focusmenu'))); };
    draw();
    setInterval(draw, 1000);
  });
})();
