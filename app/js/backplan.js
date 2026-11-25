/* Heavy days and backward planning: find the days where several big deadlines land together, and let Claude
   propose dated steps working back from one. Nothing is added until you tick the steps you want. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const bp = (C.backplan = {});

  // a day is heavy when its load reaches 3: an exam, a major or high-priority item counts 2, anything else 1
  bp.heavy = function (days) {
    const t = C.today(), end = C.addDays(t, days || 45);
    const by = {};
    C.deadlines().filter((d) => d.date > t && d.date <= end).forEach((d) => (by[d.date] = by[d.date] || []).push(d));
    const load = (x) => (x.major || x.kind === 'exam' || x.priority === 'High' ? 2 : 1);
    return Object.keys(by).sort().filter((d) => by[d].reduce((n, x) => n + load(x), 0) >= 3).map((d) => ({ date: d, items: by[d] }));
  };

  bp.section = function () {
    const days = bp.heavy(45);
    if (!days.length) return '';
    return '<section><h2>Heavy days ahead</h2><div class="runway">' + days.slice(0, 3).map((d) => '<div class="runway__row"><div><b>' + esc(C.fmtShort(d.date)) + ', ' + C.rel(d.date) + '</b><div class="muted">' + d.items.map((x) => esc(C.data.courseName(x.course) + ' ' + x.title)).join('<br>') + '</div></div><button class="btn btn--sm" type="button" data-backplan="' + d.date + '">Plan backward</button></div>').join('') + '</div></section>';
  };

  bp.open = async function (date) {
    const items = C.deadlines().filter((d) => d.date === date);
    const dlg = $('#settings');
    dlg.innerHTML = '<form method="dialog" id="bpForm"><div class="modal__head"><h2 id="settingsTitle">Work back from ' + esc(C.fmtShort(date)) + '</h2><button class="iconbtn" type="submit" value="cancel" aria-label="Close" formnovalidate>' + C.icon.x + '</button></div>' +
      '<div class="modal__body"><p class="muted">' + items.map((x) => esc(C.data.courseName(x.course) + ': ' + x.title)).join('<br>') + '</p><div id="bpBody"><div class="skel" aria-label="Claude is planning"><i></i><i></i><i></i></div><p class="muted" role="status">Claude is drafting steps…</p></div></div>' +
      '<div class="modal__foot"><button class="btn" value="cancel" type="submit" formnovalidate>Close</button><button class="btn btn--primary" type="button" id="bpAdd" disabled>Add the ticked steps</button></div></form>';
    dlg.showModal();
    if (!C.claude.available()) { $('#bpBody').innerHTML = '<p>Claude is not connected. Start Carrel with Start Carrel.cmd, or add an API key in Settings.</p>'; return; }
    const t = C.today();
    const other = C.deadlines().filter((d) => d.date >= t && d.date < date).map((d) => '- ' + d.date + ' (' + C.fmtShort(d.date) + ') ' + C.data.courseName(d.course) + ': ' + d.title).join('\n');
    const prompt = 'Today is ' + t + '. These are due on ' + date + ':\n' + items.map((x) => '- ' + C.data.courseName(x.course) + ': ' + x.title + (x.notes ? ' (' + x.notes + ')' : '')).join('\n') +
      '\n\nOther deadlines before then:\n' + (other || '(none)') +
      '\n\nPropose a backward plan: 6 to 10 concrete steps, each with a due date between today and ' + date + ', spaced around the other deadlines (nothing heavy the day before an exam), the biggest items started early. Return ONLY a JSON array: [{"title": short imperative step naming the deliverable, "due": "YYYY-MM-DD", "course": one of "c57","095","072","alab","faa","hodl","me"}]. No prose.';
    try {
      const raw = await C.claude.stream({ messages: [{ role: 'user', content: prompt }] });
      const a = raw.indexOf('['), b = raw.lastIndexOf(']');
      const steps = JSON.parse(raw.slice(a, b + 1)).filter((x) => x && typeof x.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.due || '') && x.due >= t && x.due <= date)
        .map((x) => ({ title: x.title.slice(0, 160), due: x.due, course: ['c57', '095', '072', 'alab', 'faa', 'hodl', 'me'].includes(x.course) ? x.course : (items[0] && items[0].course) || 'me' }));
      if (!steps.length) throw new Error('Claude returned no usable steps. Try again.');
      $('#bpBody').innerHTML = '<ul class="tlist bp__list">' + steps.map((x, i) => '<li class="task c-' + x.course + '"><input type="checkbox" id="bp' + i + '" checked><label for="bp' + i + '" class="task__body"><span class="task__title">' + esc(x.title) + '</span><span class="task__meta"><span class="ctag">' + esc(C.data.courseName(x.course)) + '</span><span>' + esc(C.fmtShort(x.due)) + '</span></span></label></li>').join('') + '</ul>';
      const add = $('#bpAdd');
      add.disabled = false;
      add.onclick = () => {
        const chosen = steps.filter((_, i) => $('#bp' + i).checked);
        C.tasks.patch((s) => chosen.forEach((x) => s.custom.push({ id: 'me-' + C.uid(), title: x.title, course: x.course, due: x.due })));
        dlg.close();
        C.toast(chosen.length + ' steps added to Tasks.');
        C.emit('tasks');
        C.render();
      };
    } catch (e) {
      $('#bpBody').innerHTML = '<p class="msg__err">' + esc(C.friendlyError(e)) + '</p>';
    }
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-backplan]');
    if (b) bp.open(b.dataset.backplan);
  });
})();
