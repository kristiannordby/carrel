/* Canvas and Outlook, through the local server: Canvas due dates join the deadlines (and so Tasks and the calendar),
   Canvas announcements and priority email go on Today, Outlook events go on the calendar. The server holds the
   tokens; this file only ever sees the synced data. */
(function () {
  'use strict';
  const C = window.C;
  const { esc } = C;
  const sync = (C.sync = { canvas: null, outlook: null, conn: null, at: 0 });

  sync.load = async function (force) {
    if (!C.server.ok) return;
    try {
      sync.conn = await C.api('/api/connections');
      const q = force ? '?refresh=1' : '';
      const [cv, ol] = await Promise.all([
        sync.conn.canvas.connected ? C.api('/api/canvas' + q) : null,
        sync.conn.outlook.connected ? C.api('/api/outlook' + q) : null,
      ]);
      sync.canvas = cv;
      sync.outlook = ol;
      sync.at = Date.now();
      memo = null;
      C.emit('sync');
      if (['today', 'calendar', 'tasks'].includes(C._lastView) && !document.querySelector('dialog[open]')) C.render();
    } catch (e) { /* the server is older or offline: keep what we had */ }
  };

  // ------------------------------------------------------------ Canvas items as deadlines
  // "Homework 3" and "HW3", "Problem Set 3" and "PS 3" are the same item
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/\bhomework\s*#?\s*(\d+)/g, 'hw$1').replace(/\bhw\s*#?\s*(\d+)/g, 'hw$1')
    .replace(/\b(?:problem\s*set|pset|ps)\s*#?\s*(\d+)/g, 'ps$1').replace(/\bassignment\s*#?\s*(\d+)/g, 'a$1')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'for', 'on', 'in', 'due', 'submit', 'submission', 'upload', 'canvas', 'gradescope', 'deadline', 'by']);
  function same(a, b) {
    const x = new Set(norm(a)), y = new Set(norm(b));
    if (!x.size || !y.size) return false;
    let n = 0;
    x.forEach((w) => y.has(w) && n++);
    return n / Math.min(x.size, y.size) >= 0.6 || [...x].some((w) => /^(hw|ps|a)\d+$/.test(w) && y.has(w));
  }
  let memo = null;
  // planner deadlines a Canvas item matches get its link; the rest join as Canvas deadlines
  function merged(base) {
    const cv = sync.canvas;
    if (!cv || !cv.items || !cv.items.length) return base;
    const sig = base.map((d) => d.id + d.date + d.title).join('|');
    if (memo && memo.sig === sig && memo.at === sync.at) return memo.out;
    const out = base.map((d) => Object.assign({}, d));
    cv.items.forEach((it) => {
      if (it.kind === 'event') return; // Canvas calendar events are class sessions; the planner has those
      const hit = out.find((d) => d.src !== 'canvas' && d.course === it.course && Math.abs(C.daysBetween(d.date, it.date)) <= 2 && same(d.title, it.title));
      if (hit) { hit.canvas = { url: it.url, date: it.date, time: it.time, done: it.done, title: it.title }; return; }
      out.push({ id: it.id, date: it.date, time: it.time, title: it.title, course: it.course, priority: it.points >= 20 ? 'High' : 'Medium',
        major: false, kind: it.kind === 'quiz' ? 'due' : 'due', src: 'canvas', url: it.url, canvasCourse: it.courseName, canvasDone: it.done,
        notes: 'From Canvas' + (it.courseName && it.course === 'canvas' ? ' (' + it.courseName + ')' : '') + (it.points ? ', ' + it.points + ' points' : '') + (it.missing ? '. Canvas marks it missing.' : '.') });
    });
    out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
    memo = { sig, at: sync.at, out };
    return out;
  }
  // Canvas sites that are not one of your five courses (a workshop, a club) show as "Canvas"
  const baseName = C.data.courseName;
  C.data.courseName = (id) => (id === 'canvas' ? 'Canvas' : baseName(id));
  const baseDeadlines = C.deadlines;
  C.deadlines = () => merged(baseDeadlines());
  // submitted on Canvas counts as done, unless you un-ticked it here
  sync.doneRemote = (id) => {
    const cv = sync.canvas && sync.canvas.items;
    if (!cv) return false;
    const it = cv.find((x) => x.id === id);
    if (it) return !!it.done;
    const d = C.deadlines().find((x) => x.id === id);
    return !!(d && d.canvas && d.canvas.done); // a planner deadline Canvas says is submitted
  };
  const baseDone = C.isDone;
  C.isDone = (id) => {
    if (baseDone(id)) return true;
    if ((C.store.get('tasks', {}).undone || {})[id]) return false;
    return sync.doneRemote(id);
  };

  // ------------------------------------------------------------ Outlook events by day
  sync.eventsOn = function (iso) {
    const ev = (sync.outlook && sync.outlook.events) || [];
    return ev.filter((e) => e.date <= iso && (e.endDate || e.date) >= iso).map((e) => Object.assign({}, e, { start: e.date === iso ? e.start : null, cont: e.date !== iso }))
      .sort((a, b) => (a.allDay ? '' : a.start || '').localeCompare(b.allDay ? '' : b.start || ''));
  };

  // ------------------------------------------------------------ Today: priority email and announcements
  const ago = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 864e5);
    const day = C.iso(d);
    return day === C.today() ? 'today ' + C.fmtTime(d.toTimeString().slice(0, 5)) : days < 7 ? C.fmtShort(day) : C.fmtShort(day);
  };
  sync.mailSection = function () {
    const o = sync.outlook, conn = sync.conn && sync.conn.outlook;
    if (!conn) return '';
    if (!conn.connected) return '<section><h2>Priority email</h2><p class="muted">Sign in to Outlook in <button class="linkbtn" type="button" data-open-settings>Settings</button> to see flagged and urgent mail here.</p></section>';
    const hidden = C.store.get('mailHidden', {}) || {};
    const list = ((o && o.mail) || []).filter((m) => !hidden[m.id]);
    return '<section class="sync"><div class="cardbar"><h2>Priority email</h2>' + refreshBtn('outlook') + '</div>' +
      (o && o.error ? '<p class="msg__err">' + esc(o.error) + '</p>' : '') +
      (list.length ? '<ul class="mail">' + list.slice(0, 6).map((m) => '<li class="mail__item' + (m.unread ? ' is-unread' : '') + '">' +
        '<div class="mail__top"><b>' + esc(m.from || '') + '</b><span class="muted">' + esc(ago(m.received)) + '</span></div>' +
        '<a class="mail__subj" href="' + esc(m.url || '#') + '" target="_blank" rel="noopener">' + esc(m.subject) + '</a>' +
        '<p class="mail__prev">' + esc(m.preview) + '</p>' +
        '<div class="mail__foot"><span class="muted">' + esc(cap(m.why.join(', '))) + '</span><button class="linkbtn muted" type="button" data-hide-mail="' + esc(m.id) + '">Hide</button></div></li>').join('') + '</ul>'
        : '<p class="muted">Nothing urgent in the last 10 days' + (o && o.scanned ? ' (' + o.scanned + ' messages checked)' : '') + '.</p>') +
      '</section>';
  };
  sync.announcementSection = function () {
    const cv = sync.canvas, conn = sync.conn && sync.conn.canvas;
    if (!conn) return '';
    if (!conn.connected) return '<section><h2>Canvas announcements</h2><p class="muted">Connect Canvas in <button class="linkbtn" type="button" data-open-settings>Settings</button> to see announcements and sync due dates.</p></section>';
    const seen = C.store.get('annSeen', {}) || {};
    const list = (cv && cv.announcements) || [];
    return '<section class="sync"><div class="cardbar"><h2>Canvas announcements</h2>' + refreshBtn('canvas') + '</div>' +
      (cv && cv.error ? '<p class="msg__err">' + esc(cv.error) + '</p>' : '') +
      (list.length ? '<ul class="anns">' + list.slice(0, 5).map((a) => '<li class="ann c-' + a.course + (seen[a.id] ? '' : ' is-new') + '">' +
        '<details data-ann="' + esc(a.id) + '"><summary><span class="ann__meta"><span class="ctag">' + esc(a.course === 'canvas' ? (a.courseName || 'Canvas') : C.data.courseName(a.course)) + '</span><span class="muted">' + esc(ago(a.posted)) + (a.author ? ', ' + esc(a.author) : '') + '</span></span><b>' + esc(a.title) + '</b></summary>' +
        '<p>' + esc(a.text).replace(/\n/g, '<br>') + '</p><a href="' + esc(a.url) + '" target="_blank" rel="noopener">Open in Canvas</a></details></li>').join('') + '</ul>'
        : '<p class="muted">No announcements in the last three weeks.</p>') +
      '</section>';
  };
  // the next two weeks of Canvas work, open items first; tick one to mark it done here
  sync.assignmentSection = function () {
    const cv = sync.canvas, conn = sync.conn && sync.conn.canvas;
    const head = '<div class="cardbar"><h2>Canvas assignments</h2>' + (conn && conn.connected ? '<span class="qactions"><button class="btn btn--sm btn--quiet" type="button" data-lectures title="Save lecture slides from Canvas into your vault">Slides</button>' + refreshBtn('canvas') + '</span>' : '') + '</div>';
    if (!conn || !conn.connected) return '<section class="sync">' + head + '<p class="muted">' + (conn ? 'Connect Canvas in <button class="linkbtn" type="button" data-open-settings>Settings</button> to list assignments, quizzes and discussions here.' : 'Waiting for the local server.') + '</p></section>';
    const t = C.today(), end = C.addDays(t, 14);
    const list = ((cv && cv.items) || []).filter((it) => it.kind !== 'event' && it.date <= end && (it.date >= t || (it.missing && !C.isDone(it.id))))
      .map((it) => Object.assign({}, it, { isDone: C.isDone(it.id) }))
      .sort((a, b) => (a.isDone - b.isDone) || (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    return '<section class="sync">' + head + (cv && cv.error ? '<p class="msg__err">' + esc(cv.error) + '</p>' : '') +
      (list.length ? '<ul class="tlist cvlist">' + list.slice(0, 10).map((it) => {
        const late = !it.isDone && it.date < t;
        return '<li class="task c-' + it.course + (it.isDone ? ' is-done' : '') + '" data-id="' + esc(it.id) + '"><button class="check" type="button" role="checkbox" aria-checked="' + it.isDone + '" aria-label="' + esc((it.isDone ? 'Mark not done: ' : 'Mark done: ') + it.title) + '">' + C.icon.check + '</button>' +
          '<div class="task__body"><span class="task__title"><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></span>' +
          '<span class="task__meta"><span class="ctag">' + esc(it.course === 'canvas' ? it.courseName || 'Canvas' : C.data.courseName(it.course)) + '</span><span class="due' + (late ? ' is-late' : it.date === t ? ' is-today' : '') + '">' + esc((it.date === t ? 'Today' : C.fmtShort(it.date)) + (it.time ? ' ' + C.fmtTime(it.time) : '')) + '</span>' +
          (it.submitted ? '<span>submitted</span>' : it.missing ? '<span class="is-late">missing</span>' : it.points ? '<span>' + it.points + ' pts</span>' : '') + '</span></div><span></span></li>';
      }).join('') + '</ul>' : '<p class="muted">Nothing due on Canvas in the next two weeks.</p>') + '</section>';
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.cvlist .check');
    if (!b) return;
    C.tasks.toggle(b.closest('.task').dataset.id);
    C.render();
  });
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) + '.' : '');
  const refreshBtn = (what) => '<button class="btn btn--sm btn--quiet" type="button" data-sync-refresh="' + what + '" title="Sync now">Sync</button>';

  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-hide-mail], [data-sync-refresh], [data-open-settings]');
    if (!t) return;
    if (t.dataset.hideMail) { C.store.update('mailHidden', {}, (h) => { h[t.dataset.hideMail] = Date.now(); }); C.render(); return; }
    if (t.hasAttribute('data-open-settings')) { const b = document.getElementById('openSettings'); b && b.click(); setTimeout(() => { const s = document.getElementById('connections'); s && s.scrollIntoView({ block: 'start' }); }, 50); return; }
    t.disabled = true; t.textContent = 'Syncing…';
    await sync.load(true);
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details[data-ann]') && d.open) { C.store.update('annSeen', {}, (s) => { s[d.dataset.ann] = Date.now(); }); d.closest('.ann').classList.remove('is-new'); }
  }, true);

  // ------------------------------------------------------------ Settings: connections
  sync.settingsHtml = function () {
    const c = (sync.conn && sync.conn.canvas) || { base: 'https://canvas.mit.edu' };
    const o = (sync.conn && sync.conn.outlook) || {};
    if (!C.server.ok) return '<fieldset id="connections"><legend>Connections</legend><p class="field__help">Canvas and Outlook need Carrel’s local server: open Carrel.exe or Start Carrel.cmd.</p></fieldset>';
    return '<fieldset id="connections"><legend>Connections</legend>' +
      '<div class="conn"><h3>Canvas</h3>' + (c.connected
        ? '<p>Connected as ' + esc(c.user || 'you') + ' at ' + esc(c.base) + '. Due dates sync to Calendar and Tasks; announcements show on Today.</p><div class="qactions"><button class="btn btn--sm" type="button" data-lectures>Lecture files…</button><button class="btn btn--sm" type="button" id="cvOff">Disconnect</button></div>'
        : '<p class="field__help">In Canvas, open Account, then Settings, then <b>New access token</b>. Give it a purpose (Carrel) and copy the token here. Carrel keeps it on this computer, outside OneDrive, and only reads.</p>' +
          '<div class="grid2"><label class="field">Canvas address<input type="url" id="cvBase" value="' + esc(c.base || 'https://canvas.mit.edu') + '" autocomplete="off"></label>' +
          '<label class="field">Access token<input type="password" id="cvToken" autocomplete="off" placeholder="Paste the token"></label></div>' +
          '<div class="qactions"><button class="btn btn--sm btn--primary" type="button" id="cvOn">Connect Canvas</button><span class="field__help" id="cvMsg" role="status"></span></div>') + '</div>' +
      '<div class="conn"><h3>Outlook</h3>' + (o.connected
        ? '<p>Signed in as ' + esc(o.user || 'you') + '. Calendar events show on the Calendar; flagged and urgent mail shows on Today. Read-only.</p><div class="qactions"><button class="btn btn--sm" type="button" id="olOff">Sign out</button></div>'
        : '<p class="field__help">Outlook needs an app registration you own (once): in the Azure portal, App registrations, New registration, single tenant; then Authentication, <b>Allow public client flows</b> on; API permissions, Microsoft Graph, delegated <b>Calendars.Read</b> and <b>Mail.Read</b>. Paste its Application (client) ID here.</p>' +
          '<div class="grid2"><label class="field">Application (client) ID<input type="text" id="olClient" value="' + esc(o.clientId || '') + '" autocomplete="off" spellcheck="false"></label>' +
          '<label class="field">Directory (tenant) ID<input type="text" id="olTenant" value="' + esc(o.tenant || 'organizations') + '" autocomplete="off" spellcheck="false"></label></div>' +
          '<div class="qactions"><button class="btn btn--sm btn--primary" type="button" id="olOn">Sign in to Outlook</button></div><div id="olFlow" role="status"></div>') + '</div>' +
      '</fieldset>';
  };
  sync.bindSettings = function (dlg) {
    const $ = (s) => dlg.querySelector(s);
    const reopen = () => { dlg.close(); document.getElementById('openSettings').click(); };
    if ($('#cvOn')) $('#cvOn').onclick = async () => {
      const b = $('#cvOn'); b.disabled = true; $('#cvMsg').textContent = 'Checking the token with Canvas…';
      try {
        const r = await C.api('/api/connect/canvas', { method: 'POST', body: JSON.stringify({ base: $('#cvBase').value, token: $('#cvToken').value }) });
        if (r.error) { $('#cvMsg').textContent = r.error; b.disabled = false; return; }
        C.toast('Canvas connected as ' + r.user + '. Syncing.');
        await sync.load(true); reopen();
      } catch (e) { $('#cvMsg').textContent = C.friendlyError(e); b.disabled = false; }
    };
    if ($('#cvOff')) $('#cvOff').onclick = async () => { await C.api('/api/connect/canvas/off', { method: 'POST', body: '{}' }); await sync.load(); reopen(); };
    if ($('#olOff')) $('#olOff').onclick = async () => { await C.api('/api/connect/outlook/off', { method: 'POST', body: '{}' }); await sync.load(); reopen(); };
    if ($('#olOn')) $('#olOn').onclick = async () => {
      const box = $('#olFlow'), b = $('#olOn'); b.disabled = true; box.innerHTML = '<p class="field__help">Asking Microsoft for a sign-in code…</p>';
      const r = await C.api('/api/connect/outlook', { method: 'POST', body: JSON.stringify({ clientId: $('#olClient').value, tenant: $('#olTenant').value }) }).catch((e) => ({ error: C.friendlyError(e) }));
      if (r.error) { box.innerHTML = '<p class="msg__err">' + esc(r.error) + '</p>'; b.disabled = false; return; }
      const f = r.flow;
      box.innerHTML = '<div class="devcode"><p>Open <a href="' + esc(f.verification_uri) + '" target="_blank" rel="noopener">' + esc(f.verification_uri.replace(/^https?:\/\//, '')) + '</a> and enter this code, then sign in with your MIT account:</p><p class="devcode__code">' + esc(f.user_code) + '</p><p class="field__help" id="olWait">Waiting for you to finish in the browser…</p></div>';
      const t0 = Date.now();
      const tick = async () => {
        if (!dlg.open) return;
        const st = await C.api('/api/connections').catch(() => null);
        const fl = st && st.outlook.flow;
        if (st && st.outlook.connected && (!fl || fl.state === 'done')) { C.toast('Outlook connected. Syncing.'); await sync.load(true); reopen(); return; }
        if (fl && fl.state === 'failed') { box.innerHTML = '<p class="msg__err">' + esc(fl.error || 'Sign-in failed.') + '</p>'; b.disabled = false; return; }
        if (Date.now() - t0 < 16 * 60000) setTimeout(tick, 3000);
      };
      setTimeout(tick, 3000);
    };
  };

  // ------------------------------------------------------------ lecture files: Canvas -> Atlas/Resources/Lectures/<course>
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const STATUS = { new: 'Not in the vault', updated: 'Changed on Canvas', synced: 'In the vault', have: 'Already in the vault' };
  sync.lectures = async function () {
    const dlg = document.getElementById('settings');
    if (dlg.open) dlg.close();
    dlg.innerHTML = '<form method="dialog" id="lecForm"><div class="modal__head"><h2 id="settingsTitle">Lecture files from Canvas</h2><button class="iconbtn" type="submit" value="cancel" aria-label="Close" formnovalidate>' + C.icon.x + '</button></div>' +
      '<div class="modal__body" id="lecBody"><div class="skel" aria-label="Loading"><i></i><i></i><i></i></div><p class="muted" role="status">Reading each course’s files on Canvas…</p></div>' +
      '<div class="modal__foot"><label class="lec__auto"><input type="checkbox" id="lecAuto"' + (C.store.get('lectureAuto') ? ' checked' : '') + '> Fetch new lecture slides automatically</label><button class="btn" value="cancel" type="submit" formnovalidate>Close</button><button class="btn btn--primary" type="button" id="lecGo" disabled>Save to the vault</button></div></form>';
    dlg.showModal();
    dlg.querySelector('#lecAuto').onchange = (e) => { C.store.set('lectureAuto', e.target.checked); if (e.target.checked) C.toast('New lecture slides will be saved to your vault after each Canvas sync.'); };
    let data;
    try { data = await C.api('/api/lectures'); } catch (e) { data = { error: C.friendlyError(e) }; }
    const body = dlg.querySelector('#lecBody');
    if (!dlg.open || !body) return;
    if (!data.connected) { body.innerHTML = '<p>Connect Canvas in Settings first.</p>'; return; }
    if (data.error) { body.innerHTML = '<p class="msg__err">' + esc(data.error) + '</p>'; return; }
    const cs = data.courses || [];
    body.innerHTML = '<p class="field__help">PDF, PowerPoint and Keynote files from each course’s Files tab (or its Modules, when Files is hidden). New lecture slides are ticked. Slides go to the course’s lecture folder, syllabi to Attachments/Syllabi, anything else to the course’s Efforts folder. Files already in any of those, by name or by identical size, are left alone.</p>' +
      (cs.length ? cs.map((c) => '<section class="lec"><div class="cardbar"><h3><span class="ctag c-' + c.course + '">' + esc(C.data.courseName(c.course)) + '</span> ' + esc(c.folder) + '</h3><span class="muted">' + (c.source === 'modules' ? 'from Modules' : '') + '</span></div>' +
        (c.error ? '<p class="msg__err">' + esc(c.error) + '</p>' : '') +
        (c.files.length ? '<ul class="lec__list">' + c.files.map((f) => {
          const can = f.status === 'new' || f.status === 'updated';
          return '<li class="lec__row' + (can ? '' : ' is-have') + '"><label><input type="checkbox" value="' + f.id + '"' + (can && f.lecture ? ' checked' : '') + (can ? '' : ' disabled') + '><span class="lec__name">' + esc(f.name) + '</span></label>' +
            '<span class="muted">' + esc((f.folder ? f.folder + ', ' : '') + kb(f.size) + (f.updated ? ', ' + C.fmtShort(C.iso(new Date(f.updated))) : '') + (f.dest && f.dest !== c.folder ? ', goes to ' + f.dest : '')) + '</span><span class="lec__st is-' + f.status + '">' + STATUS[f.status] + '</span></li>';
        }).join('') + '</ul>' : '<p class="muted">No slide files on Canvas for this course.</p>') + '</section>').join('')
        : '<p class="muted">None of your Canvas courses match a lecture folder in the vault.</p>');
    const go = dlg.querySelector('#lecGo');
    const count = () => { const n = body.querySelectorAll('input:checked').length; go.disabled = !n; go.textContent = n ? 'Save ' + n + (n === 1 ? ' file' : ' files') + ' to the vault' : 'Save to the vault'; };
    body.addEventListener('change', count);
    count();
    go.onclick = async () => {
      const ids = [...body.querySelectorAll('input:checked')].map((x) => +x.value);
      go.disabled = true;
      const r = await C.api('/api/lectures/download', { method: 'POST', body: JSON.stringify({ ids }) }).catch((e) => ({ error: C.friendlyError(e) }));
      if (r.error) { C.toast(r.error); go.disabled = false; return; }
      const job = await watchJob((j) => { go.textContent = 'Saving ' + Math.min(j.done + 1, j.total) + ' of ' + j.total + '…'; });
      if (dlg.open) dlg.close();
      reportJob(job);
    };
  };
  async function watchJob(onTick) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 700));
      const j = await C.api('/api/lectures/job').catch(() => null);
      if (!j) return null;
      if (onTick) onTick(j);
      if (j.state !== 'running') return j;
    }
  }
  async function reportJob(j) {
    if (!j) return;
    const saved = j.saved || [], failed = j.failed || [];
    C.toast(saved.length ? 'Saved ' + saved.length + (saved.length === 1 ? ' lecture file' : ' lecture files') + ' to your vault' + (failed.length ? '; ' + failed.length + ' failed (' + failed[0].name + ': ' + failed[0].error + ')' : '') + '.' : failed.length ? 'Could not save ' + failed[0].name + ': ' + failed[0].error : 'Nothing new to save.');
    if (saved.length) {
      // the new PDFs show up as "New lecture PDFs", ready to build a question set from
      if (C.newdecks && C.newdecks.refresh) await C.newdecks.refresh();
      C.render();
    }
  }
  // after a Canvas sync, at most every 6 hours: save new lecture slides when you asked for that
  async function autoLectures() {
    if (!C.store.get('lectureAuto') || !(sync.conn && sync.conn.canvas.connected)) return;
    const last = +C.store.get('lectureAutoAt', 0);
    if (Date.now() - last < 6 * 3600e3) return;
    C.store.set('lectureAutoAt', Date.now());
    const data = await C.api('/api/lectures').catch(() => null);
    const ids = data && data.courses ? data.courses.flatMap((c) => c.files.filter((f) => f.lecture && f.status === 'new').map((f) => f.id)) : [];
    if (!ids.length) return;
    const r = await C.api('/api/lectures/download', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => null);
    if (r && r.ok) reportJob(await watchJob());
  }
  C.on('sync', () => { autoLectures(); });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-lectures]')) sync.lectures(); });

  // ------------------------------------------------------------ when to sync
  C.on('ready', () => {
    sync.load();
    setInterval(() => sync.load(), 10 * 60000);
    window.addEventListener('focus', () => { if (Date.now() - sync.at > 5 * 60000) sync.load(); });
  });
})();
