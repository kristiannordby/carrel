/* Recovery: log sleep, workouts and a morning check-in; derive a recovery score and a readiness call from them. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const rec = (C.recovery = {});

  const data = () => Object.assign({ sleep: {}, workouts: [], checkins: {} }, C.store.get('recovery', {}));
  const save = (fn) => C.store.update('recovery', {}, (d) => { d.sleep = d.sleep || {}; d.workouts = d.workouts || []; d.checkins = d.checkins || {}; fn(d); d._t = Date.now(); });
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  rec.hours = (e) => { if (!e || !e.bed || !e.wake) return null; let d = mins(e.wake) - mins(e.bed); if (d <= 0) d += 1440; return d / 60; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const bedMin = (e) => { const m = mins(e.bed); return m < 12 * 60 ? m + 1440 : m; }; // after-midnight bedtimes count as late, not early

  // ------------------------------------------------------------ scoring
  rec.sleepScore = function (d, date) {
    const e = d.sleep[date];
    const h = rec.hours(e);
    if (h == null) return null;
    const need = C.settings().sleepNeed;
    const dur = 55 * Math.pow(clamp(h / need, 0, 1), 2);
    const qual = 25 * (e.q ? (e.q - 1) / 4 : 0.6);
    const prior = [];
    for (let k = 1; k <= 7; k++) { const p = d.sleep[C.addDays(date, -k)]; if (p && p.bed) prior.push(bedMin(p)); }
    let cons = 15;
    if (prior.length >= 2) {
      prior.sort((a, b) => a - b);
      const med = prior[Math.floor(prior.length / 2)];
      cons = 20 * clamp(1 - Math.abs(bedMin(e) - med) / 120, 0, 1);
    }
    return { score: Math.round(dur + qual + cons), h, dur, qual, cons };
  };
  rec.debt = function (d, date) {
    const need = C.settings().sleepNeed;
    let debt = 0, n = 0;
    for (let k = 0; k < 7; k++) { const h = rec.hours(d.sleep[C.addDays(date, -k)]); if (h != null) { debt += Math.max(0, need - h); n++; } }
    return { debt, n };
  };
  rec.dayLoad = (d, date) => d.workouts.filter((w) => w.date === date).reduce((s, w) => s + (w.min || 0) * (w.rpe || 5), 0);
  rec.load = function (d, date) {
    // chronic window grows with your history (7 to 28 days) so a new log does not read as a spike
    const first = d.workouts.reduce((m, w) => (w.date < m ? w.date : m), date);
    const span = Math.max(7, Math.min(28, C.daysBetween(first, date) + 1));
    let a = 0, c = 0;
    for (let k = 0; k < span; k++) { const l = rec.dayLoad(d, C.addDays(date, -k)); if (k < 7) a += l; c += l; }
    const acute = a / 7, chronic = c / span;
    const acwr = chronic > 0 ? acute / chronic : null;
    const yday = rec.dayLoad(d, C.addDays(date, -1));
    let f = 1;
    if (acwr != null) {
      if (acwr > 1.3) f = clamp(1 - (acwr - 1.3) * 0.7, 0.45, 1);
      else if (acwr < 0.8) f = 0.97;
    }
    if (chronic > 0 && yday > 2.2 * chronic) f -= 0.1;
    return { acute, chronic, acwr, yday, factor: clamp(f, 0.3, 1) };
  };
  // resting heart rate against your own 14-day median: each beat above it costs 2 points, up to 12
  rec.rhr = function (d, date) {
    const e = d.sleep[date];
    if (!e || !e.rhr) return null;
    const prior = [];
    for (let k = 1; k <= 14; k++) { const p = d.sleep[C.addDays(date, -k)]; if (p && p.rhr) prior.push(p.rhr); }
    if (prior.length < 3) return { rhr: e.rhr, base: null, dev: 0, penalty: 0 };
    prior.sort((a, b) => a - b);
    const base = prior[Math.floor(prior.length / 2)];
    const dev = e.rhr - base;
    return { rhr: e.rhr, base, dev, penalty: clamp(dev * 2, 0, 12) };
  };
  // when to be asleep before each exam in the next week: wake 90 minutes before it (7:00 at the latest), then count back your sleep need
  rec.bedtimes = function () {
    const t = C.today();
    const need = C.settings().sleepNeed;
    return C.deadlines().filter((x) => x.kind === 'exam' && x.date > t && x.date <= C.addDays(t, 7)).map((x) => {
      const cls = C.classesOn(x.date).find((k) => k.course === x.course);
      const start = x.time || (cls && cls.start) || '09:00';
      const wake = Math.min(7 * 60, mins(start) - 90);
      let bed = wake - need * 60 - 15;
      const night = C.addDays(x.date, -1);
      if (bed < 0) bed += 1440;
      const hh = String(Math.floor(bed / 60) % 24).padStart(2, '0') + ':' + String(Math.round(bed % 60)).padStart(2, '0');
      const ww = String(Math.floor(wake / 60)).padStart(2, '0') + ':' + String(wake % 60).padStart(2, '0');
      return { exam: x, start, night, bed: hh, wake: ww, guessed: !x.time && !cls };
    });
  };
  rec.compute = function (date) {
    const d = data();
    date = date || C.today();
    const s = rec.sleepScore(d, date) || rec.sleepScore(d, C.addDays(date, -1));
    if (!s) return null;
    const debt = rec.debt(d, date);
    const load = rec.load(d, date);
    const debtScore = 100 * clamp(1 - debt.debt / 6, 0, 1);
    const hr = rec.rhr(d, date);
    const recovery = Math.round(clamp(0.55 * s.score + 0.2 * debtScore + 0.25 * 100 * load.factor - (hr ? hr.penalty : 0), 0, 100));
    const ci = d.checkins[date];
    let subj = null;
    if (ci) subj = Math.round(100 * (((ci.energy || 3) - 1) / 4 + (5 - (ci.soreness || 3)) / 4 + (5 - (ci.stress || 3)) / 4) / 3);
    const readiness = subj == null ? recovery : Math.round(0.7 * recovery + 0.3 * subj);
    return { date, sleep: s, debt, debtScore: Math.round(debtScore), load, hr, recovery, subj, readiness };
  };
  rec.label = function (x) {
    if (x >= 80) return ['Primed', 'Good night, fresh legs. A hard session or a long study block will land.'];
    if (x >= 65) return ['Ready', 'Train and study as planned.'];
    if (x >= 50) return ['Moderate', 'Keep intensity in check; put the hardest problem sets early.'];
    if (x >= 35) return ['Low', 'An easy day: zone 2 or mobility, review instead of new material.'];
    return ['Rest', 'Sleep debt or load is high. Rest, and protect tonight’s sleep.'];
  };

  // ------------------------------------------------------------ charts (one axis each, hover tooltips)
  function chart({ id, title, days, values, max, fmt, kind, ref, refLabel, cls }) {
    const W = 640, H = 168, pl = 34, pr = 10, pt = 14, pb = 24;
    const iw = W - pl - pr, ih = H - pt - pb;
    const n = days.length, bw = iw / n;
    const y = (v) => pt + ih - (v / max) * ih;
    let g = '';
    const ticks = [0, max / 2, max];
    ticks.forEach((t) => (g += '<line class="gridl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (pl - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmt(t) + '</text>'));
    days.forEach((d, i) => { if (i % 2 === (n - 1) % 2) g += '<text x="' + (pl + bw * i + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + C.parse(d).getDate() + '</text>'; });
    if (kind === 'bar') {
      values.forEach((v, i) => {
        if (v == null || v <= 0) return;
        const x = pl + bw * i + 3, w = Math.max(2, bw - 6), top = y(Math.min(v, max)), h = pt + ih - top;
        const r = Math.min(4, w / 2, h);
        // rounded data end, square at the baseline
        g += '<path class="' + cls(v) + '" d="M' + x + ',' + (pt + ih) + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + top + ' ' + (x + w) + ',' + (top + r) + 'V' + (pt + ih) + 'Z"/>';
      });
    } else {
      const pts = values.map((v, i) => (v == null ? null : [pl + bw * i + bw / 2, y(v)]));
      let path = '', pen = false;
      pts.forEach((p) => { if (!p) { pen = false; return; } path += (pen ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); pen = true; });
      g += '<path class="line-rec" d="' + path + '"/>';
      pts.forEach((p) => { if (p) g += '<circle class="dot-rec" cx="' + p[0] + '" cy="' + p[1] + '" r="4"/>'; });
      const lastI = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
      if (lastI != null) g += '<text class="lbl-end" x="' + (pts[lastI][0]) + '" y="' + (pts[lastI][1] - 10) + '" text-anchor="middle">' + fmt(values[lastI]) + '</text>';
    }
    if (ref != null) g += '<line class="need" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(ref) + '" y2="' + y(ref) + '"/><text x="' + (W - pr) + '" y="' + (y(ref) - 4) + '" text-anchor="end">' + esc(refLabel) + '</text>';
    g += '<line class="axis" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (pt + ih) + '" y2="' + (pt + ih) + '"/>';
    days.forEach((d, i) => (g += '<rect class="hit" data-i="' + i + '" x="' + (pl + bw * i) + '" y="' + pt + '" width="' + bw + '" height="' + ih + '" fill="transparent"/>'));
    return '<figure class="chartfig" id="' + id + '"><figcaption><h3>' + esc(title) + '</h3></figcaption>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title + ': ' + days.map((d, i) => C.fmtShort(d) + ' ' + (values[i] == null ? 'none' : fmt(values[i]))).join(', ')) + '">' + g + '</svg>' +
      '<div class="tip" role="status" hidden></div></figure>';
  }
  function bindTips(root, days, series) {
    $$('.chartfig', root).forEach((fig) => {
      const tip = $('.tip', fig);
      const s = series[fig.id];
      $$('.hit', fig).forEach((r) => {
        const show = () => {
          const i = +r.dataset.i;
          tip.hidden = false;
          tip.innerHTML = '<b>' + esc(C.fmtShort(days[i])) + '</b> ' + esc(s(i));
          const fb = fig.getBoundingClientRect(), rb = r.getBoundingClientRect();
          tip.style.left = clamp(rb.left - fb.left + rb.width / 2 - tip.offsetWidth / 2, 0, fb.width - tip.offsetWidth) + 'px';
        };
        r.addEventListener('mouseenter', show);
        r.addEventListener('mouseleave', () => (tip.hidden = true));
      });
    });
  }

  // ------------------------------------------------------------ view
  C.routes.recovery = {
    title: 'Recovery',
    render(main) {
      const d = data();
      const t = C.today();
      const x = rec.compute(t);
      const need = C.settings().sleepNeed;
      const days = []; for (let k = 13; k >= 0; k--) days.push(C.addDays(t, -k));
      const sleepVals = days.map((dd) => rec.hours(d.sleep[dd]));
      const recVals = days.map((dd) => { const r = rec.sleepScore(d, dd) ? rec.compute(dd) : null; return r ? r.recovery : null; });
      const loadVals = days.map((dd) => rec.dayLoad(d, dd) || null);
      const hasAny = Object.keys(d.sleep).length || d.workouts.length;
      const lastSleep = d.sleep[t] || {};
      const ci = d.checkins[t] || {};
      const lab = x ? rec.label(x.readiness) : null;
      const rlab = x ? rec.label(x.recovery) : null;

      let bedHtml = '';
      const left = !x
        ? '<div class="state"><h3>No sleep logged yet</h3><p>Log last night with the form. One night gives a recovery score; a week of nights adds sleep debt and bedtime consistency; workouts add training load.</p></div>'
        : '<dl class="gauge">' +
          '<div><dt>Recovery</dt><dd><span class="bigfig">' + x.recovery + '</span><span class="lbl">' + rlab[0] + '</span><span class="why">Sleep, a week of sleep debt and training load.</span></dd></div>' +
          '<div><dt>Readiness today</dt><dd><span class="bigfig">' + x.readiness + '</span><span class="lbl">' + lab[0] + '</span><span class="why">' + esc(lab[1]) + (x.subj == null ? ' Add a check-in to include how you feel.' : '') + '</span></dd></div></dl>' +
          '<dl class="parts">' +
          part('Last night', x.sleep.h.toFixed(1) + ' h, sleep score ' + x.sleep.score, x.sleep.score / 100) +
          part('Sleep debt, 7 nights', x.debt.debt.toFixed(1) + ' h short over ' + x.debt.n + ' logged', x.debtScore / 100) +
          part('Training load', x.load.acwr == null ? 'no workouts in 4 weeks' : 'acute to chronic ' + x.load.acwr.toFixed(2) + (x.load.acwr > 1.3 ? ', ramping fast' : x.load.acwr < 0.8 ? ', backing off' : ', steady'), x.load.factor) +
          (x.hr ? part('Resting heart rate', x.hr.base ? x.hr.rhr + ' bpm, ' + (x.hr.dev > 0 ? '+' : '') + x.hr.dev + ' on your ' + x.hr.base + ' baseline' : x.hr.rhr + ' bpm (baseline after 3 more mornings)', x.hr.base ? 1 - x.hr.penalty / 12 : 1) : '') +
          (x.subj != null ? part('How you feel', x.subj + ' of 100', x.subj / 100) : '') + '</dl>';
      const beds = rec.bedtimes();
      bedHtml = beds.length ? '<section><h2>Before your exams</h2><dl class="parts">' + beds.map((b) => '<div><dt>' + esc(C.data.courseName(b.exam.course) + ' ' + b.exam.title + ', ' + C.fmtShort(b.exam.date) + ' ' + C.fmtTime(b.start) + (b.guessed ? ' (time not in planner)' : '')) + '</dt><dd>asleep by ' + C.fmtTime(b.bed) + ' ' + esc(C.DOW[C.parse(b.night).getDay()]) + ', up at ' + C.fmtTime(b.wake) + '</dd></div>').join('') + '</dl></section>' : '';

      const charts = hasAny
        ? '<section class="side"><div class="legend"><span><i style="--k: var(--color-accent)"></i>Recovery score</span><span><i style="--k: color-mix(in oklab, var(--color-accent) 35%, var(--color-paper-3))"></i>Slept at least ' + need + ' h</span></div>' +
          chart({ id: 'chSleep', title: 'Sleep, last 14 nights (hours)', days, values: sleepVals, max: Math.max(10, Math.ceil(Math.max(...sleepVals.filter(Boolean), 0))), fmt: (v) => (Math.round(v * 10) / 10) + '', kind: 'bar', ref: need, refLabel: 'need ' + need + ' h', cls: (v) => 'bar-sleep' + (v >= need ? ' is-met' : '') }) +
          chart({ id: 'chRec', title: 'Recovery score', days, values: recVals, max: 100, fmt: (v) => Math.round(v) + '', kind: 'line' }) +
          (d.workouts.length ? chart({ id: 'chLoad', title: 'Training load (minutes × effort)', days, values: loadVals, max: Math.max(100, ...loadVals.filter(Boolean)), fmt: (v) => Math.round(v) + '', kind: 'bar', cls: () => 'bar-load' }) : '') +
          // the same numbers as a table, for keyboard and screen-reader use
          '<details class="how"><summary>Show the numbers</summary><table class="history"><thead><tr><th scope="col">Day</th><th scope="col">Sleep (h)</th><th scope="col">Recovery</th><th scope="col">Load</th></tr></thead><tbody>' +
          days.slice().reverse().filter((dd, i) => sleepVals[13 - i] != null || loadVals[13 - i] != null).map((dd) => { const i = days.indexOf(dd); return '<tr><td>' + esc(C.fmtShort(dd)) + '</td><td>' + (sleepVals[i] == null ? '' : sleepVals[i].toFixed(1)) + '</td><td>' + (recVals[i] == null ? '' : recVals[i]) + '</td><td>' + (loadVals[i] == null ? '' : Math.round(loadVals[i])) + '</td></tr>'; }).join('') +
          '</tbody></table></details>' +
          '</section>'
        : '';

      // workout calendar: one month, Sunday first, each day lists its sessions
      const ym = rec.month || t.slice(0, 7);
      const [cy, cm] = ym.split('-').map(Number);
      const first = ym + '-01', lead = C.parse(first).getDay();
      const nDays = new Date(cy, cm, 0).getDate();
      const shift = (n) => { const x = new Date(cy, cm - 1 + n, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
      const byDay = {};
      d.workouts.forEach((w) => (byDay[w.date] = byDay[w.date] || []).push(w));
      const inMonth = d.workouts.filter((w) => w.date.slice(0, 7) === ym);
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<div class="wcal__day is-out" aria-hidden="true"></div>';
      for (let k = 1; k <= nDays; k++) {
        const dd = ym + '-' + String(k).padStart(2, '0'), ws = byDay[dd] || [];
        cells += '<button type="button" class="wcal__day' + (dd === t ? ' is-today' : '') + (ws.length ? ' has-work' : '') + '" data-wday="' + dd + '" aria-label="' + esc(C.fmtLong(dd) + (ws.length ? ': ' + ws.map((w) => w.type + ' ' + w.min + ' min' + (rec.detail(w) ? ', ' + rec.detail(w) : '')).join(', ') : ', no workout') + '. Log a workout on this day') + '"><span class="wcal__n">' + k + '</span>' +
          ws.map((w) => '<span class="wcal__w" title="' + esc(w.type + ', ' + w.min + ' min, effort ' + w.rpe + (rec.detail(w) ? ', ' + rec.detail(w) : '') + (w.note ? ', ' + w.note : '')) + '">' + esc(w.type) + ' <span class="muted">' + (w.dist ? w.dist + ' mi' : w.ex ? w.ex.length + ' ex' : w.min) + '</span></span>').join('') + '</button>';
      }
      const calHtml = '<section class="wcal"><div class="wcal__head"><h2>Workouts, ' + esc(C.MONL[cm - 1] + ' ' + cy) + '</h2><div class="wcal__nav"><button class="btn btn--sm" type="button" data-wmonth="' + shift(-1) + '" aria-label="Previous month">Prev</button>' + (ym !== t.slice(0, 7) ? '<button class="btn btn--sm" type="button" data-wmonth="' + t.slice(0, 7) + '">This month</button>' : '') + '<button class="btn btn--sm" type="button" data-wmonth="' + shift(1) + '" aria-label="Next month">Next</button></div></div>' +
        '<p class="muted">' + (inMonth.length ? inMonth.length + ' sessions, ' + inMonth.reduce((s, w) => s + (w.min || 0), 0) + ' minutes, on ' + new Set(inMonth.map((w) => w.date)).size + ' days.' : 'No workouts this month.') + ' Pick a day to log a workout on it.</p>' +
        '<div class="wcal__grid"><div class="wcal__dow" aria-hidden="true">' + C.DOW.map((x) => '<span>' + x + '</span>').join('') + '</div>' + cells + '</div></section>';

      const recent = [];
      Object.keys(d.sleep).forEach((k) => recent.push({ date: k, kind: 'sleep', id: k, text: (rec.hours(d.sleep[k]) || 0).toFixed(1) + ' h, ' + C.fmtTime(d.sleep[k].bed) + ' to ' + C.fmtTime(d.sleep[k].wake) + (d.sleep[k].q ? ', quality ' + d.sleep[k].q : '') }));
      d.workouts.forEach((w) => recent.push({ date: w.date, kind: 'workout', id: w.id, text: w.type + ', ' + w.min + ' min at effort ' + w.rpe + (rec.detail(w) ? ', ' + rec.detail(w) : '') + (w.note ? ', ' + w.note : '') }));
      recent.sort((a, b) => b.date.localeCompare(a.date));

      main.innerHTML =
        '<div class="page"><div class="phead"><div><h1>Recovery</h1><p>Sleep and training, scored each morning. Scores come from your entries only.</p></div></div>' +
        '<div class="rec"><div class="side">' + left + bedHtml + calHtml + charts +
        (recent.length ? '<section><h2>Log</h2><table class="history"><thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col">Kind</th><th scope="col"><span class="visually-hidden">Delete</span></th></tr></thead><tbody>' +
          recent.slice(0, 20).map((r) => '<tr><td>' + esc(C.fmtShort(r.date)) + '</td><td>' + esc(r.text) + '</td><td>' + r.kind + '</td><td><button class="iconbtn" type="button" data-del="' + r.kind + ':' + esc(r.id) + '" aria-label="Delete ' + r.kind + ' entry">' + C.icon.trash + '</button></td></tr>').join('') + '</tbody></table></section>' : '') +
        '<details class="how"><summary>How the scores work</summary><ul>' +
        '<li>Sleep score (0 to 100): hours against your need of ' + need + ' h (55 points, squared so short nights cost more), quality 1 to 5 (25 points), bedtime within two hours of your recent median (20 points).</li>' +
        '<li>Sleep debt: hours short of your need over the last 7 logged nights; 6 h of debt zeroes this part.</li>' +
        '<li>Training load: minutes × effort (1 to 10) per day. The 7-day average against the 28-day average (acute to chronic) above 1.3 lowers recovery; a single day over 2.2× your norm costs 10 points the next morning.</li>' +
        '<li>Recovery = 55% sleep score + 20% debt + 25% load, minus 2 points per beat your resting heart rate sits above its 14-day median (12 at most). Readiness adds your check-in (energy, soreness, stress) at 30%.</li>' +
        '<li>Exam bedtimes: up 90 minutes before the exam (7 am at the latest), asleep your sleep need plus 15 minutes earlier. Exam times come from the planner, or the course\u2019s class slot that day.</li>' +
        '<li>This is a heuristic for planning the day, not a medical measure.</li></ul></details>' +
        '</div>' +
        '<div class="logform">' +
        '<form id="fSleep"><fieldset><legend>Sleep</legend>' +
        '<div class="grid3"><label class="field">Morning of<input type="date" name="date" value="' + t + '" required></label><label class="field">Bed<input type="time" name="bed" value="' + esc(lastSleep.bed || '23:30') + '" required></label><label class="field">Woke<input type="time" name="wake" value="' + esc(lastSleep.wake || '06:30') + '" required></label></div>' +
        scale('Sleep quality', 'q', 5, lastSleep.q, ['restless', 'deep']) +
        '<div class="grid2"><label class="field">Resting heart rate (optional)<input type="number" name="rhr" inputmode="numeric" min="30" max="120" value="' + esc(lastSleep.rhr || '') + '"></label></div>' +
        '<div><button class="btn btn--primary" type="submit">Log sleep</button></div></fieldset></form>' +
        '<form id="fWork"><fieldset><legend>Workout</legend>' +
        '<div class="grid3"><label class="field">Date<input type="date" name="date" value="' + t + '" required></label><label class="field">Type<select name="type">' + ['Run', 'Lift', 'Ruck', 'AFT practice', 'Conditioning', 'Bike', 'Swim', 'Sport', 'Mobility', 'Other'].map((o) => '<option>' + o + '</option>').join('') + '</select></label><label class="field">Minutes<input type="number" name="min" inputmode="numeric" min="5" max="400" value="45" required></label></div>' +
        '<div class="grid2" data-for="run" hidden><label class="field">Distance (mi)<input type="number" name="dist" inputmode="decimal" min="0" max="200" step="0.01"></label><label class="field">Pace (min:sec per mi)<input type="text" name="pace" inputmode="numeric" pattern="\\d{1,2}:[0-5]\\d" placeholder="from time and distance" autocomplete="off"></label></div>' +
        '<div class="field" data-for="lift" hidden><span>Exercises</span><div class="exrows" id="exRows">' + exRow() + '</div><div><button class="btn btn--sm" type="button" id="exAdd">Add exercise</button></div></div>' +
        scale('Effort (session RPE)', 'rpe', 10, 6, ['easy', 'max']) +
        '<label class="field">Note (optional)<input type="text" name="note" autocomplete="off" placeholder="5 x 800 m, deadlift 3RM"></label>' +
        '<div><button class="btn" type="submit">Log workout</button></div></fieldset></form>' +
        '<form id="fCheck"><fieldset><legend>Check-in</legend>' +
        scale('Energy', 'energy', 5, ci.energy, ['drained', 'sharp']) + scale('Soreness', 'soreness', 5, ci.soreness, ['none', 'very sore']) + scale('Stress', 'stress', 5, ci.stress, ['calm', 'swamped']) +
        '<div><button class="btn" type="submit">Save check-in</button></div></fieldset></form>' +
        '</div></div></div>';

      $$('.scale button', main).forEach((b) => (b.onclick = () => { $$('button', b.parentElement).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); b.parentElement.dataset.v = b.dataset.v; }));
      const sv = (form, name) => { const s = $('.scale[data-name="' + name + '"]', form); return s && s.dataset.v ? +s.dataset.v : null; };
      $('#fSleep').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target, fd = new FormData(f);
        const entry = { bed: fd.get('bed'), wake: fd.get('wake'), q: sv(f, 'q'), rhr: fd.get('rhr') ? +fd.get('rhr') : null };
        const h = rec.hours(entry);
        if (h > 16) {
          const w = f.querySelector('[name="wake"]');
          w.setAttribute('aria-invalid', 'true');
          w.setAttribute('aria-describedby', 'sleepErr');
          if (!f.querySelector('#sleepErr')) w.closest('.grid3').insertAdjacentHTML('afterend', '<span class="field__help msg__err" id="sleepErr">That is ' + h.toFixed(1) + ' hours of sleep. Check the bed and wake times.</span>');
          w.focus();
          return;
        }
        save((d) => (d.sleep[fd.get('date')] = entry));
        C.toast('Sleep logged: ' + h.toFixed(1) + ' h.');
        C.render();
      };
      const wf = $('#fWork'), typeSel = wf.querySelector('[name="type"]');
      const showFor = () => $$('[data-for]', wf).forEach((x) => (x.hidden = x.dataset.for !== kindOf(typeSel.value)));
      typeSel.onchange = showFor;
      showFor();
      $('#exAdd').onclick = () => {
        const rows = $('#exRows'), last = rows.lastElementChild;
        rows.insertAdjacentHTML('beforeend', exRow());
        // carry the last weight and reps forward, the usual case for the next set or lift
        if (last) ['exSets', 'exReps', 'exWt'].forEach((n) => (rows.lastElementChild.querySelector('[name="' + n + '"]').value = last.querySelector('[name="' + n + '"]').value));
        rows.lastElementChild.querySelector('[name="exName"]').focus();
      };
      $('#exRows').onclick = (e) => { const b = e.target.closest('[data-exdel]'); if (b && $$('.exrow', wf).length > 1) b.closest('.exrow').remove(); };
      $('#fWork').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target, fd = new FormData(f);
        const w = { id: C.uid(), date: fd.get('date'), type: fd.get('type'), min: +fd.get('min'), rpe: sv(f, 'rpe') || 6, note: fd.get('note') };
        if (kindOf(w.type) === 'run' && +fd.get('dist') > 0) {
          w.dist = +fd.get('dist');
          const m = /^(\d{1,2}):([0-5]\d)$/.exec(fd.get('pace') || '');
          w.pace = m ? +m[1] * 60 + +m[2] : Math.round((w.min * 60) / w.dist);
        }
        if (kindOf(w.type) === 'lift') {
          const ex = $$('.exrow', f).map((r) => ({ name: r.querySelector('[name="exName"]').value.trim(), sets: +r.querySelector('[name="exSets"]').value || 1, reps: +r.querySelector('[name="exReps"]').value || 0, wt: r.querySelector('[name="exWt"]').value === '' ? null : +r.querySelector('[name="exWt"]').value })).filter((x) => x.name);
          if (ex.length) w.ex = ex;
        }
        save((d) => d.workouts.push(w));
        C.toast('Workout logged.');
        C.render();
      };
      $('#fCheck').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        save((d) => (d.checkins[t] = { energy: sv(f, 'energy') || 3, soreness: sv(f, 'soreness') || 3, stress: sv(f, 'stress') || 3 }));
        C.toast('Check-in saved.');
        C.render();
      };
      $$('[data-wmonth]', main).forEach((b) => (b.onclick = () => { rec.month = b.dataset.wmonth; C.render(); }));
      $$('[data-wday]', main).forEach((b) => (b.onclick = () => {
        const f = $('#fWork');
        f.querySelector('[name="date"]').value = b.dataset.wday;
        f.scrollIntoView({ block: 'center' });
        f.querySelector('[name="type"]').focus({ preventScroll: true });
      }));
      $$('[data-del]', main).forEach((b) => (b.onclick = () => {
        const [kind, id] = b.dataset.del.split(':');
        const before = JSON.parse(JSON.stringify(data()));
        save((d) => { if (kind === 'sleep') delete d.sleep[id]; else d.workouts = d.workouts.filter((w) => w.id !== id); });
        C.render();
        C.toast('Entry deleted.', { label: 'Undo', fn: () => { C.store.set('recovery', before); C.render(); } });
      }));
      bindTips(main, days, {
        chSleep: (i) => (sleepVals[i] == null ? 'not logged' : sleepVals[i].toFixed(1) + ' h'),
        chRec: (i) => (recVals[i] == null ? 'no score' : 'recovery ' + recVals[i]),
        chLoad: (i) => (loadVals[i] == null ? 'rest day' : Math.round(loadVals[i]) + ' load'),
      });
    },
  };
  C.chart = chart;
  C.chartTips = bindTips;
  // which extra fields a workout type takes
  function kindOf(type) { return /^(Run|Ruck)$/.test(type) ? 'run' : /^(Lift|AFT practice|Conditioning)$/.test(type) ? 'lift' : ''; }
  function exRow() {
    return '<div class="exrow"><label class="field">Exercise<input type="text" name="exName" autocomplete="off" placeholder="Deadlift"></label><label class="field">Sets<input type="number" name="exSets" inputmode="numeric" min="1" max="50" value="3"></label><label class="field">Reps<input type="number" name="exReps" inputmode="numeric" min="0" max="500"></label><label class="field">Weight (lb)<input type="number" name="exWt" inputmode="decimal" min="0" max="2000" step="0.5"></label><button class="iconbtn" type="button" data-exdel aria-label="Remove this exercise">' + C.icon.trash + '</button></div>';
  }
  const fmtPace = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  // one line describing a workout's details: distance and pace, or the exercises done
  rec.detail = function (w) {
    const out = [];
    if (w.dist) out.push(w.dist + ' mi' + (w.pace ? ' at ' + fmtPace(w.pace) + '/mi' : ''));
    if (w.ex) out.push(w.ex.map((x) => x.name + ' ' + x.sets + '×' + x.reps + (x.wt != null ? ' @ ' + x.wt + ' lb' : '')).join('; '));
    return out.join(', ');
  };
  function part(name, val, v) { return '<div><dt>' + esc(name) + '</dt><dd>' + esc(val) + '</dd><div class="meter" aria-hidden="true"><i style="--v:' + clamp(v, 0, 1).toFixed(3) + '"></i></div></div>'; }
  function scale(label, name, n, val, ends) {
    let b = '';
    for (let i = 1; i <= n; i++) b += '<button type="button" data-v="' + i + '" aria-pressed="' + (val === i) + '" aria-label="' + esc(label) + ' ' + i + ' of ' + n + '">' + i + '</button>';
    return '<div class="field" role="group" aria-label="' + esc(label) + '"><span>' + esc(label) + '</span><div class="scale" data-name="' + name + '"' + (val ? ' data-v="' + val + '"' : '') + '>' + b + '</div><div class="scale__ends"><span>' + esc(ends[0]) + '</span><span>' + esc(ends[1]) + '</span></div></div>';
  }
})();
