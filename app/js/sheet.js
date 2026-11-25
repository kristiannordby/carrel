/* Printable review sheet for an exam: key points per lecture, the questions you missed with their answers, your notes. */
(function () {
  'use strict';
  const C = window.C;
  const { $, esc } = C;

  C.routes.sheet = {
    title: 'Review sheet',
    render(main, r) {
      const cid = r.parts[0];
      const c = C.data.course(cid);
      if (!c || !c.units || !c.units.length) { main.innerHTML = '<div class="page"><div class="state"><h3>No study sets for that course</h3><p><a href="#/study">Back to Study</a></p></div></div>'; return; }
      const exam = C.deadlines().find((d) => d.course === cid && d.kind === 'exam' && d.date >= C.today());
      const ids = (r.q.units || '').split(',').filter(Boolean);
      const units = c.units.filter((u) => (ids.length ? ids.includes(u.id) : exam ? C.study.examUnits(exam).includes(u.id) : true));
      const p = C.store.get('progress', {});
      const notes = C.store.get('notes', {});
      let missedN = 0;
      const blocks = units.map((u) => {
        const missed = u.quiz.filter((q) => { const e = p[C.study.qkey(cid, u.id, q)]; return e && e.last === 0; });
        const mine = u.quiz.map((q) => notes[C.study.qkey(cid, u.id, q)]).filter(Boolean);
        missedN += missed.length;
        const points = u.kp && u.kp.length ? u.kp : u.topics.filter((t) => t.x).map((t) => t.n + ': ' + t.x);
        return '<section class="sheet__unit"><h2>' + esc(u.label + ' ' + u.title) + '</h2>' +
          (points.length ? '<ul class="sheet__kp">' + points.map((k) => '<li>' + C.inline(k) + '</li>').join('') + '</ul>' : '<p class="muted">Topics: ' + esc(u.topics.map((t) => t.n).join(', ')) + '</p>') +
          (missed.length ? '<h3>Missed last time</h3><ol class="sheet__miss">' + missed.map((q) => '<li><span>' + C.inline(q.q) + '</span><b>' + C.inline(q.o[q.a]) + '</b>' + (q.e ? '<em>' + C.inline(q.e.length > 260 ? q.e.slice(0, 257) + '…' : q.e) + '</em>' : '') + (q.s ? '<small>' + esc(C.slideLabel(q.s)) + '</small>' : '') + '</li>').join('') + '</ol>' : '') +
          (mine.length ? '<h3>Your notes</h3><ul class="sheet__kp">' + mine.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
          // on screen only: your vault notes on this lecture, to open beside the sheet
          (C.notes && C.notes.best(c.id, u, 2).length ? '<p class="muted noprint">In your vault: ' + C.notes.best(c.id, u, 2).map((n) => '<button class="linkbtn" type="button" data-note="' + esc(n.path) + '">' + esc(n.title) + '</button>').join(' and ') + '</p>' : '') + '</section>';
      }).join('');
      main.innerHTML =
        '<div class="page sheet"><div class="phead"><div><h1>' + esc(c.code + ' ' + (exam ? exam.title : c.short) + ' review') + '</h1>' +
        '<p>' + esc(units.length + ' lectures' + (exam ? ', exam ' + C.fmtLong(exam.date) : '') + ', ' + missedN + ' missed questions. Printed ' + C.fmtShort(C.today()) + '.') + '</p></div>' +
        '<div class="phead__tools noprint"><a class="btn" href="#/study/' + cid + '/exam/quiz">Back to the drill</a><button class="btn" type="button" id="sheetMd">' + C.icon.copy + ' Copy as Markdown</button><button class="btn btn--primary" type="button" id="sheetPrint">' + C.icon.print + ' Print</button></div></div>' +
        '<div class="sheet__body">' + blocks + '</div></div>';
      C.renderMath(main);
      $('#sheetPrint').onclick = () => window.print();
      // the same sheet as an Obsidian note: paste it into Efforts/Exams
      $('#sheetMd').onclick = async () => {
        const lines = ['# ' + c.code + ' ' + (exam ? exam.title : c.short) + ' review', '', (exam ? 'Exam: ' + exam.date + '. ' : '') + 'Made in Carrel on ' + C.today() + '.', ''];
        units.forEach((u) => {
          lines.push('## ' + u.label + ' ' + u.title, '');
          const points = u.kp && u.kp.length ? u.kp : u.topics.filter((t) => t.x).map((t) => t.n + ': ' + t.x);
          points.forEach((k) => lines.push('- ' + k));
          const missed = u.quiz.filter((q) => { const e = p[C.study.qkey(cid, u.id, q)]; return e && e.last === 0; });
          if (missed.length) { lines.push('', '### Missed last time', ''); missed.forEach((q, i) => lines.push((i + 1) + '. ' + q.q, '   - Answer: ' + q.o[q.a] + (q.s ? ' (' + C.slideLabel(q.s) + ')' : ''))); }
          const mine = u.quiz.map((q) => notes[C.study.qkey(cid, u.id, q)]).filter(Boolean);
          if (mine.length) { lines.push('', '### My notes', ''); mine.forEach((n) => lines.push('- ' + n)); }
          lines.push('');
        });
        try { await navigator.clipboard.writeText(lines.join('\n')); C.toast('Copied. Paste it into a note in Efforts/Exams.'); } catch (e) { C.toast('The browser blocked the clipboard.'); }
      };
    },
  };
})();
