/* First start: connect Canvas, then download every class file into the vault, sorted, and link the study sets to it.
   Shown until the first sync finishes (or "Don't ask again"); the server keeps that flag outside the repo. */
(function () {
  'use strict';
  const C = window.C;
  const { $, esc } = C;
  const CANVAS = 'https://canvas.mit.edu';
  const w = (C.welcome = {});
  let setup = null, step = 1, closedThisSession = false;

  function dlg() { return document.getElementById('welcome'); }

  function frame(title, body, foot) {
    return '<form method="dialog" class="welcome"><div class="modal__head"><h2 id="welcomeTitle">' + esc(title) + '</h2>' +
      '<span class="muted welcome__step">Step ' + step + ' of 3</span></div>' +
      '<div class="modal__body">' + body + '</div><div class="modal__foot">' + foot + '</div></form>';
  }

  const later = '<button class="btn btn--quiet" type="button" data-w="later">Not now</button>';

  function render() {
    const d = dlg();
    if (step === 1) {
      d.innerHTML = frame('Welcome to Carrel',
        '<p>Carrel is your study hall for the MBAn: quizzes and flashcards for every lecture, linked to the exact slide, plus your deadlines, tasks and a Claude tutor.</p>' +
        '<p>Two minutes of setup: connect Canvas, and Carrel downloads the slides and files for all six classes and sorts them into your Obsidian vault.</p>' +
        '<label class="field">Your name<input type="text" id="wName" autocomplete="given-name" value="' + esc(C.me()) + '" placeholder="First name"></label>' +
        '<p class="field__help">Your vault: <code>' + esc(setup.vault) + '</code>' + (setup.vaultExists ? '' : ' (Carrel will create it)') + '</p>' +
        '<p class="field__help">' + (setup.claude ? 'Claude Code found: the tutor and study-set builder will work.' : 'Claude Code was not found on this computer. Everything except the Claude tutor works; install Claude Code later (see the README) to turn it on.') + '</p>',
        '<button class="btn btn--quiet" type="button" data-w="skip">Don’t show again</button>' + later + '<button class="btn btn--primary" type="button" data-w="next1">Next</button>');
    } else if (step === 2) {
      d.innerHTML = frame('Connect Canvas',
        '<ol class="welcome__steps">' +
        '<li>Open <a href="' + CANVAS + '/profile/settings" target="_blank" rel="noopener">your Canvas settings</a> (Account, then Settings) and sign in with your MIT account.</li>' +
        '<li>Scroll to <b>Approved Integrations</b> and click <b>+ New Access Token</b>.</li>' +
        '<li>Purpose: <b>Carrel</b>. Leave the expiry empty (or pick a date after finals) and click <b>Generate Token</b>.</li>' +
        '<li>Copy the long token Canvas shows (it is shown only once) and paste it below.</li></ol>' +
        '<label class="field">Canvas access token<input type="password" id="wToken" autocomplete="off" spellcheck="false" placeholder="Paste the token"></label>' +
        '<p class="field__help">The token stays on this computer (in your user profile, never in the vault or the repo). Carrel only reads from Canvas.</p>' +
        '<p class="msg__err" id="wErr" role="alert" hidden></p>',
        later + '<button class="btn btn--primary" type="button" data-w="connect">Connect Canvas</button>');
      setTimeout(() => { const t = $('#wToken', d); t && t.focus(); }, 50);
    } else {
      const j = setup.job || {};
      const running = j.state === 'running', done = j.state === 'done', failed = j.state === 'failed';
      const pct = j.total ? Math.round((100 * j.done) / j.total) : 0;
      const body = done
        ? '<p><b>All set.</b> ' + j.saved + ' file' + (j.saved === 1 ? '' : 's') + ' saved' + (j.already ? ', ' + j.already + ' already in your vault' : '') + '.</p>' +
          (j.folders && j.folders.length ? '<ul class="welcome__where">' + j.folders.map(([f, n]) => '<li><code>' + esc(f) + '</code> <span class="muted">' + n + '</span></li>').join('') + '</ul>' : '') +
          (j.failed && j.failed.length ? '<p class="msg__err">' + j.failed.length + ' could not be saved (first: ' + esc(j.failed[0].name + ': ' + j.failed[0].error) + '). Retry later from Settings, Lecture files.</p>' : '') +
          '<p class="field__help">New slides keep arriving on their own: Carrel checks Canvas while it is open and saves new lecture decks to your vault.</p>'
        : '<p>Canvas is connected' + (setup.canvas.user ? ' as <b>' + esc(setup.canvas.user) + '</b>' : '') + '. Carrel will now save every file from your six classes into your vault:</p>' +
          '<ul class="welcome__where"><li>Lecture slides to <code>Atlas/Resources/Lectures/&lt;class&gt;</code></li><li>Syllabi to <code>Attachments/Syllabi</code></li><li>Homework, solutions and handouts to <code>Efforts/Courses/&lt;class&gt;</code></li></ul>' +
          (running || failed ? '<div class="welcome__prog"><div class="welcome__bar" style="--p:' + (pct / 100) + '"></div></div><p class="field__help" role="status">' + esc(j.phase || '') +
            (j.total ? ' ' + j.done + ' of ' + j.total : '') + (j.current ? '<br><span class="muted">' + esc(j.current) + '</span>' : '') + '</p>' : '<p class="field__help">This takes a few minutes the first time (a few hundred MB).</p>') +
          (failed ? '<p class="msg__err" role="alert">' + esc(j.error || 'The sync stopped.') + '</p>' : '');
      const foot = done ? '<button class="btn btn--primary" type="button" data-w="finish">Open Carrel</button>'
        : running ? '<span class="muted">You can keep this open; it finishes on its own.</span>'
          : later + '<button class="btn btn--primary" type="button" data-w="sync">' + (failed ? 'Try again' : 'Download and sort my class files') + '</button>';
      d.innerHTML = frame(done ? 'Your vault is ready' : 'Download your class files', body, foot);
    }
  }

  async function poll() {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      try { setup = await C.api('/api/setup'); } catch (e) { continue; }
      if (dlg().open) render();
      if (!setup.job || setup.job.state !== 'running') return;
    }
  }

  function wire() {
    dlg().addEventListener('click', async (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const act = b.dataset.w;
      if (act === 'later') { closedThisSession = true; dlg().close(); return; }
      if (act === 'skip') { await C.api('/api/setup/skip', { method: 'POST', body: '{}' }).catch(() => null); dlg().close(); C.toast('Connect Canvas any time in Settings.'); return; }
      if (act === 'next1') {
        const name = ($('#wName', dlg()).value || '').trim();
        if (name) C.store.set('settings', Object.assign({}, C.store.get('settings', {}), { name }));
        step = setup.canvas.connected ? 3 : 2;
        return render();
      }
      if (act === 'connect') {
        const token = ($('#wToken', dlg()).value || '').trim(), err = $('#wErr', dlg());
        if (!token) { err.hidden = false; err.textContent = 'Paste the token from Canvas first.'; return; }
        b.disabled = true; b.textContent = 'Checking with Canvas…';
        const r = await C.api('/api/connect/canvas', { method: 'POST', body: JSON.stringify({ base: CANVAS, token }) }).catch((x) => ({ error: C.friendlyError(x) }));
        if (r.error) { err.hidden = false; err.textContent = r.error; b.disabled = false; b.textContent = 'Connect Canvas'; return; }
        setup = await C.api('/api/setup');
        step = 3;
        if (C.sync && C.sync.load) C.sync.load();
        return render();
      }
      if (act === 'sync') {
        b.disabled = true;
        const r = await C.api('/api/setup/firstsync', { method: 'POST', body: '{}' }).catch((x) => ({ error: C.friendlyError(x) }));
        if (r.error) { setup.job = { state: 'failed', error: r.error }; return render(); }
        setup.job = r;
        render();
        poll();
        return;
      }
      if (act === 'finish') {
        C.store.set('lectureAuto', true); // keep new slides flowing into the vault after each Canvas sync
        dlg().close();
        location.reload();
      }
    });
    dlg().addEventListener('cancel', () => { closedThisSession = true; });
  }

  w.open = async function (force) {
    if (!C.server.ok || (closedThisSession && !force)) return;
    try { setup = await C.api('/api/setup'); } catch (e) { return; }
    if (!force && (setup.firstSync || setup.skipped)) return;
    const running = setup.job && setup.job.state === 'running';
    step = running || (setup.job && setup.job.state === 'done') ? 3 : 1;
    const d = dlg();
    if (!d.dataset.wired) { wire(); d.dataset.wired = '1'; }
    render();
    if (!d.open) d.showModal();
    if (running) poll();
  };

  C.on('ready', () => setTimeout(() => w.open(false), 400));
})();
