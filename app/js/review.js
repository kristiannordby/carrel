/* One review session across every course: the due questions, weakest box first, through the normal quiz runner of each course in turn. */
(function () {
  'use strict';
  const C = window.C;
  C.routes.review = {
    title: 'Review',
    render(main) {
      // the queue moves course by course; each course's own due set keeps its own session and schedule
      const next = C.data.courses().filter((c) => c.units.length).map((c) => [c, C.study.dueCount(c.id)]).filter((x) => x[1] > 0);
      if (!next.length) {
        main.innerHTML = '<div class="page"><div class="state"><h3>Nothing due anywhere</h3><p>Every answered question is scheduled for a later day. Start an exam drill to get ahead.</p><a class="btn" href="#/today">Back to Today</a></div></div>';
        return;
      }
      C.go('#/study/' + next[0][0].id + '/due/quiz', true);
    },
  };
})();
