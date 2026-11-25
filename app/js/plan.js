/* Exam study plan: for every exam in the next two weeks, spread its lectures over the days left, weakest first.
   The day before is a mock exam plus the review queue. A day's plan is frozen once made, so finishing
   a drill does not reshuffle what you already committed to; "Rebuild" re-plans from today's mastery. */
(function () {
  'use strict';
  const C = window.C;
  const plan = (C.plan = {});

  function build(today) {
    const ready = C.recovery && C.recovery.compute(today);
    const scale = !ready ? 1 : ready.readiness < 50 ? 0.6 : ready.readiness < 65 ? 0.8 : 1;
    const exams = C.deadlines().filter((d) => d.kind === 'exam' && d.date > today && d.date <= C.addDays(today, 14) && C.data.course(d.course) && (C.data.course(d.course).units || []).length);
    const days = {};
    const add = (date, item) => (days[date] = days[date] || []).push(item);
    exams.forEach((ex) => {
      const unitIds = C.study.examUnits(ex);
      const c = C.data.course(ex.course);
      const units = unitIds.map((id) => c.units.find((u) => u.id === id)).filter((u) => u && u.quiz.length);
      if (!units.length) return;
      const left = C.daysBetween(today, ex.date); // days before the exam, today included
      const eve = C.addDays(ex.date, -1);
      add(eve, { kind: 'mock', course: ex.course, exam: ex.title, title: 'Mock exam for ' + C.data.courseName(ex.course) + ' ' + ex.title, link: '#/study/' + ex.course + '/mock?new=1' });
      add(eve, { kind: 'due', course: ex.course, exam: ex.title, title: 'Clear the ' + C.data.courseName(ex.course) + ' review queue', link: '#/study/' + ex.course + '/due/quiz' });
      const drillDays = left - 1;
      if (drillDays <= 0) return;
      // weakest first: lowest share right, untouched lectures count as weakest
      const ranked = units.map((u) => { const m = C.study.unitMastery(ex.course, u); return { u, need: m.seen ? 1 - m.pct : 1.2 }; }).sort((a, b) => b.need - a.need);
      const per = Math.max(1, Math.ceil(ranked.length / drillDays));
      for (let d = 0; d < drillDays; d++) {
        let chunk = ranked.slice(d * per, d * per + per);
        if (!chunk.length) chunk = ranked.slice(0, Math.min(2, ranked.length)); // spare days go back to the weakest
        const date = C.addDays(today, d);
        const labels = Array.from(new Set(chunk.map((x) => (x.u.label === 'All' ? 'cross-cutting' : x.u.label)))).join(', ');
        add(date, {
          kind: 'drill', course: ex.course, exam: ex.title, units: chunk.map((x) => x.u.id),
          title: C.data.courseName(ex.course) + ' ' + labels + ': drill for ' + ex.title + (d === 0 && scale < 1 ? ' (lighter today, readiness ' + ready.readiness + ')' : ''),
          link: '#/study/' + ex.course + '/exam/quiz?units=' + chunk.map((x) => x.u.id).join(',') + '&n=' + Math.max(8, Math.round(Math.min(30, 12 * chunk.length) * (d === 0 ? scale : 1))),
          light: d === 0 && scale < 1,
        });
      }
    });
    Object.keys(days).forEach((d) => days[d].forEach((it, i) => (it.id = 'plan-' + d + '-' + it.course + '-' + it.kind + '-' + i)));
    return days;
  }

  // frozen per day: today's entries never move once made; future days are recomputed each morning
  plan.get = function () {
    const t = C.today();
    let p = C.store.get('plan');
    if (!p || p.made !== t) {
      p = C.stamp({ made: t, days: build(t) });
      C.store.set('plan', p);
    }
    return p.days;
  };
  plan.rebuild = function () { C.store.set('plan', C.stamp({ made: C.today(), days: build(C.today()) })); };
  plan.items = function (from, to) {
    const days = plan.get();
    const out = [];
    Object.keys(days).sort().forEach((d) => { if (d >= from && d <= to) days[d].forEach((it) => out.push(Object.assign({ date: d }, it))); });
    return out;
  };
})();
