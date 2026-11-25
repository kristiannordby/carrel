/* Boot: find the local server, pull the live vault and saved state, wire keys and settings, draw. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;

  C.keysheet = function () {
    const dlg = $('#settings');
    const rows = [
      ['Anywhere', [['/', 'Search and actions'], ['Ctrl K', 'Search and actions'], ['C', 'Open Claude'], ['T', 'Tasks in the side panel'], ['Esc', 'Close the panel or popover'], ['?', 'This sheet']]],
      ['Study', [['Ctrl B', 'Hide or show the lecture-set sidebar']]],
      ['Quiz', [['1 to 4', 'Answer'], ['G', 'Mark as a guess first'], ['U', 'Undo the answer'], ['M', 'Flag or unflag the question and its topic'], ['Enter or \u2192', 'Next question'], ['\u2190', 'Previous'], ['S', 'Open the linked slide'], ['F', 'The linked slide, full screen'], ['E', 'Explain the concept']]],
      ['Flashcards', [['Space', 'Flip'], ['1', 'Still learning'], ['2', 'Know it'], ['\u2190 \u2192', 'Move'], ['S', 'Open the slide']]],
      ['Mock exam', [['1 to 4', 'Pick'], ['F', 'Flag for review'], ['\u2190 \u2192', 'Move']]],
      ['Slides panel', [['\u2190 \u2192', 'Page, outside Study']]],
      ['Walkthrough', [['\u2190 \u2192', 'Previous and next page']]],
    ];
    dlg.innerHTML = '<form method="dialog"><div class="modal__head"><h2 id="settingsTitle">Keyboard</h2><button class="iconbtn" type="submit" aria-label="Close">' + C.icon.x + '</button></div><div class="modal__body">' +
      rows.map(([h, ks]) => '<section><h3>' + h + '</h3><dl class="keys">' + ks.map(([k, d]) => '<div><dt>' + k.split(' or ').map((x) => '<kbd>' + esc(x) + '</kbd>').join(' or ') + '</dt><dd>' + esc(d) + '</dd></div>').join('') + '</dl></section>').join('') +
      '</div></form>';
    dlg.showModal();
  };
  function applyTheme() {
    const t = C.settings().theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  async function refreshVault(quiet) {
    if (!C.server.ok) return false;
    try {
      const v = await C.api('/api/vault');
      window.CARREL_VAULT = v;
      C.emit('vault');
      if (!quiet) C.toast('Reloaded planner.md and the A-Lab decks.');
      return true;
    } catch (e) { if (!quiet) C.toast('Could not read the vault: ' + e.message); return false; }
  }
  C.refreshVault = refreshVault;
  C.applyTheme = () => applyTheme();

  // ------------------------------------------------------------ settings
  function openSettings() {
    const s = C.settings();
    const secret = C.store.get('settings.secret', {});
    const dlg = $('#settings');
    const v = C.data.vault();
    dlg.innerHTML =
      '<form method="dialog" id="setForm"><div class="modal__head"><h2 id="settingsTitle">Settings</h2><button class="iconbtn" type="submit" value="cancel" aria-label="Close settings" formnovalidate>' + C.icon.x + '</button></div>' +
      '<div class="modal__body">' +
      '<label class="field">Appearance<select name="theme">' + [['auto', 'Match the system'], ['light', 'Day'], ['dark', 'Night']].map(([k, l]) => '<option value="' + k + '"' + (s.theme === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="field">Claude connection<select name="backend"><option value="auto"' + (s.backend !== 'api' ? ' selected' : '') + '>Claude Code on this machine, API key as fallback</option><option value="api"' + (s.backend === 'api' ? ' selected' : '') + '>Anthropic API key only</option></select>' +
      '<span class="field__help">Now: ' + esc(C.claude.describe()) + (C.server.ok ? (C.server.claude ? '. Claude Code found.' : '. Claude Code not found on PATH.') : '. Local server not running.') + '</span></label>' +
      '<div class="grid2"><label class="field">Model for Claude Code<select name="model">' + ['sonnet', 'opus', 'haiku'].map((m) => '<option' + (s.model === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></label>' +
      '<label class="field">Model for the API<input type="text" name="apiModel" value="' + esc(s.apiModel) + '" autocomplete="off"></label></div>' +
      '<label class="field">Anthropic API key (kept in this browser only)<input type="password" name="apiKey" value="' + esc(secret.apiKey || '') + '" autocomplete="off" placeholder="Only needed without Claude Code"></label>' +
      '<div class="grid2"><label class="field">Sleep need (hours)<input type="number" name="sleepNeed" min="5" max="11" step="0.25" value="' + s.sleepNeed + '"></label>' +
      '<label class="field">Task window (days)<select name="taskWindow">' + [7, 14, 60].map((n) => '<option' + (+s.taskWindow === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div>' +
      '<label class="field"><span><input type="checkbox" name="shuffle"' + (s.shuffle !== false ? ' checked' : '') + '> Shuffle question order in lecture sets</span></label>' +
      '<label class="field"><span><input type="checkbox" name="shortcuts"' + (s.shortcuts !== false ? ' checked' : '') + '> Single-key shortcuts (1 to 4, G, S, E, C, T and the rest)</span><span class="field__help">Turn off if you use speech input.</span></label>' +
      '<div class="qactions"><button class="btn" type="button" id="setRefresh"' + (C.server.ok ? '' : ' disabled') + '>Reload from vault</button><button class="btn" type="button" id="setExport">Export my data</button><label class="btn" for="setImport">Import</label><input class="visually-hidden" type="file" id="setImport" accept="application/json"></div>' +
      (C.sync ? C.sync.settingsHtml() : '') +
      '<p class="field__help">Vault: ' + esc(v.vaultPath || 'unknown') + '. Planner read ' + esc(v.built ? C.fmtShort(v.built.slice(0, 10)) + ' at ' + C.fmtTime(v.built.slice(11, 16)) : 'at build time') + '.</p>' +
      '</div><div class="modal__foot"><button class="btn" value="cancel" type="submit" formnovalidate>Cancel</button><button class="btn btn--primary" value="ok" type="submit">Save</button></div></form>';
    dlg.showModal();
    if (C.sync) C.sync.bindSettings(dlg);
    $('#setRefresh').onclick = async () => { if (await refreshVault()) C.render(); };
    $('#setExport').onclick = () => {
      const out = {};
      Object.keys(localStorage).filter((k) => k.startsWith('carrel.') && k !== 'carrel.settings.secret').forEach((k) => (out[k] = localStorage.getItem(k)));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
      a.download = 'carrel-data-' + C.today() + '.json';
      a.click();
    };
    $('#setImport').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        Object.keys(obj).filter((k) => k.startsWith('carrel.')).forEach((k) => C.store.set(k.slice(7), JSON.parse(obj[k])));
        C.toast('Imported. Reloading.');
        setTimeout(() => location.reload(), 600);
      } catch (err) { C.toast('That file is not a Carrel export.'); }
    };
    $('#setForm').onsubmit = (e) => {
      if (!e.submitter || e.submitter.value !== 'ok') return;
      const fd = new FormData(e.target);
      C.store.update('settings', {}, (o) => {
        o.theme = fd.get('theme'); o.backend = fd.get('backend'); o.model = fd.get('model'); o.apiModel = fd.get('apiModel').trim() || 'claude-sonnet-5-5';
        o.sleepNeed = +fd.get('sleepNeed') || 8; o.taskWindow = +fd.get('taskWindow') || 7; o.shuffle = !!fd.get('shuffle'); o.shortcuts = !!fd.get('shortcuts'); o._t = Date.now();
      });
      C.store.set('settings.secret', { apiKey: (fd.get('apiKey') || '').trim() });
      applyTheme();
      setTimeout(C.render, 0);
      if (C.drawer.isOpen()) C.drawer.show(C.drawer.pane);
    };
  }

  // ------------------------------------------------------------ phones: the menu behind the header's three bars
  // (search, Claude, the focus timer, review, grades, slides, notes, settings); full screen, X to close
  const row = (act, label, sub, icon) => '<button class="mmenu__row" type="button" data-m="' + act + '">' + (icon || '') + '<span><b>' + label + '</b>' + (sub ? '<span class="muted">' + esc(sub) + '</span>' : '') + '</span></button>';
  function menuHtml() {
    const f = C.store.get('focusTimer');
    const ms = f ? (f.paused ? f.left : f.ends - Date.now()) : 0;
    const clock = f ? Math.floor(ms / 60000) + ':' + String(Math.floor((ms % 60000) / 1000)).padStart(2, '0') : '';
    return '<div class="mmenu__head"><b id="mMenuTitle">Carrel</b><button class="iconbtn" type="button" data-m="close" aria-label="Close the menu">' + C.icon.x + '</button></div>' +
      '<div class="mmenu__body">' +
      row('search', 'Search', 'Questions, cards, notes, deadlines', '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>') +
      row('chat', 'Ask Claude', 'About anything you are studying', C.icon.chat) +
      '<div class="mmenu__focus"><div class="mmenu__row is-static"><svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><circle cx="10" cy="11" r="6.5"/><path d="M10 11V7.5M8 2.5h4"/></svg><span><b>Focus timer</b><span class="muted">' +
        (f ? esc(f.what || '') + (f.paused ? ', paused at ' : ', ') + clock + (f.paused ? '' : ' left') : 'Minutes count toward today’s study time') + '</span></span></div>' +
        '<div class="qactions">' + (f ? '<button class="btn btn--sm" type="button" data-m="ftoggle">' + (f.paused ? 'Resume' : 'Pause') + '</button><button class="btn btn--sm" type="button" data-m="fstop">Stop and log</button>'
          : '<button class="btn btn--sm btn--primary" type="button" data-m="f25">25 min</button><button class="btn btn--sm" type="button" data-m="f50">50 min</button>') + '</div></div>' +
      row('review', 'Review everything due', null, C.icon.shuffle) +
      row('slides', 'Lecture slides', null, C.icon.slide) +
      row('notes', 'Your notes', null, '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M5.5 3.5h7l3 3v10h-10zM12.5 3.5v3h3M7.5 10h5M7.5 13h5"/></svg>') +
      row('grades', 'Grades', null, '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><path d="M4 16.5v-5M8 16.5v-9M12 16.5v-7M16 16.5v-12"/></svg>') +
      row('settings', 'Settings', 'Appearance, Claude, Canvas, Outlook', '<svg viewBox="0 0 20 20" aria-hidden="true" class="ic"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/></svg>') +
      '</div>';
  }
  function openMenu() {
    const p = $('#mMenuPanel');
    p.innerHTML = menuHtml();
    p.hidden = false;
    void p.offsetWidth; // lay it out closed first, so it slides in
    p.classList.add('is-open');
    document.documentElement.classList.add('sheet-open');
    $('#mMenu').setAttribute('aria-expanded', 'true');
    p.querySelector('[data-m="close"]').focus({ preventScroll: true });
  }
  function closeMenu(back) {
    const p = $('#mMenuPanel');
    if (p.hidden) return;
    p.classList.remove('is-open');
    document.documentElement.classList.remove('sheet-open');
    $('#mMenu').setAttribute('aria-expanded', 'false');
    setTimeout(() => (p.hidden = true), 220);
    if (back) $('#mMenu').focus({ preventScroll: true });
  }
  C.closeMenu = closeMenu;
  function menuAct(a) {
    if (a === 'close') return closeMenu(true);
    if (a === 'ftoggle' || a === 'fstop' || a === 'f25' || a === 'f50') {
      if (a === 'ftoggle') C.focus.toggle(); else if (a === 'fstop') C.focus.stop(false); else C.focus.start(a === 'f25' ? 25 : 50);
      $('#mMenuPanel').innerHTML = menuHtml();
      return;
    }
    closeMenu(false);
    if (a === 'search') C.search();
    if (a === 'chat') { C.drawer.open('chat'); C.chat.focus(); }
    if (a === 'review') C.go('#/review');
    if (a === 'slides') C.drawer.open('slides');
    if (a === 'notes') C.drawer.open('notes');
    if (a === 'grades') C.go('#/grades');
    if (a === 'settings') openSettings();
  }

  // ------------------------------------------------------------ keys
  function keys(e) {
    const inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !inField)) { e.preventDefault(); C.search(); return; }
    if (e.key === 'Escape') {
      if (!$('#explain').hidden) { C.explain.close ? C.explain.close() : ($('#explain').hidden = true); return; }
      if (!$('#seltool').hidden) { $('#seltool').hidden = true; return; }
      const pop = document.querySelector('.evpop');
      if (pop) { pop.remove(); const back = document.querySelector('#focusBtn'); if (pop.classList.contains('focusmenu') && back) back.focus(); return; }
      if (C.drawer.isOpen() && !document.querySelector('dialog[open]')) { C.drawer.close(); return; }
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (!C.shortcutsOn()) return;
    if (e.key === 'c' && C._lastView !== 'study') { C.drawer.open('chat'); C.chat.focus(); e.preventDefault(); }
    if (e.key === 'c' && C._lastView === 'study' && !C.study.keys) { C.drawer.open('chat'); C.chat.focus(); e.preventDefault(); }
    if (e.key === '?') { C.keysheet(); e.preventDefault(); return; }
    if (e.key === 't' && C._lastView !== 'tasks') { C.drawer.isOpen() && C.drawer.pane === 'tasks' ? C.drawer.close() : C.drawer.open('tasks'); e.preventDefault(); }
    if (C.drawer.isOpen() && C.drawer.pane === 'slides' && C._lastView !== 'study' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target.closest && e.target.closest('button, a, [role="separator"], [tabindex]'))) { C.slides.go(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); }
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    applyTheme();
    $('#openSettings').onclick = openSettings;
    $('#mMenu').onclick = openMenu;
    $('#mMenuPanel').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) menuAct(b.dataset.m); });
    $('#mMenuPanel').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(true); } });
    window.addEventListener('hashchange', () => closeMenu(false));
    $('#openSearch').onclick = () => C.search();
    document.addEventListener('keydown', keys);
    window.addEventListener('hashchange', C.render);
    C.emit('boot');
    C.render(); // draw from the bundled data at once, then refresh from the server
    await C.probe();
    if (C.server.ok) C.appVersion = await C.api('/api/version').then((x) => x.version).catch(() => null); // the version this copy is
    if (C.server.ok) {
      await Promise.all([C.store.pull(), refreshVault(true)]);
      if (C.newdecks) C.newdecks.apply();
      if (C.generate) C.generate.apply();
      C.render();
      if (C.drawer.isOpen()) C.drawer.show(C.drawer.pane);
      // re-read the vault when the window regains focus, at most every 5 minutes
      let last = Date.now();
      window.addEventListener('focus', async () => { if (Date.now() - last > 300000) { last = Date.now(); if (await refreshVault(true)) C.render(); } });
    }
    // back in front (the phone unlocked, the window focused): reconnect if the PC was out of reach,
    // then take the other device's changes; at most every 15 seconds, and never while you are typing
    let syncing = false;
    const resync = async () => {
      if (syncing || document.visibilityState !== 'visible' || Date.now() - (C.store.pulledAt || 0) < 15000) return;
      syncing = true;
      try {
        let back = false;
        if (!C.server.ok) { await C.probe(); back = C.server.ok; }
        if (!C.server.ok) return;
        if (back) { await refreshVault(true); if (C.sync) C.sync.load(); }
        const n = await C.store.pull();
        const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('input, textarea, select, [contenteditable]');
        // the app changed on the PC since this copy loaded: reload into it (your place and answers are saved),
        // or offer to when you are in the middle of typing
        const v = await C.api('/api/version').then((x) => x.version).catch(() => null);
        if (v && C.appVersion && v !== C.appVersion) {
          await C.store.flush();
          if (!typing && !document.querySelector('dialog[open]') && !document.documentElement.classList.contains('sheet-open')) { location.reload(); return; }
          if (!C._updateOffered) { C._updateOffered = true; C.toast('Carrel was updated on your PC.', { label: 'Reload', fn: () => location.reload() }); }
        }
        if (v && !C.appVersion) C.appVersion = v;
        if ((n || back) && !typing && !document.querySelector('dialog[open]')) C.render();
      } finally { syncing = false; }
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    setInterval(resync, 60000);
    // installable on a phone: keep the app and the study sets for when the PC is out of reach
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    C.emit('ready');
    if (window.katex) C.renderMath($('#main'));
    else { const k = document.querySelector('script[src*="katex"]'); k && k.addEventListener('load', () => C.renderMath($('#main'))); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
