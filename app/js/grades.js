/* Grades: each course's components and weights from planner.md; enter your scores, see where you stand
   and what you need on the rest to reach a target. Scores stay in this browser and the local server. */
(function () {
  'use strict';
  const C = window.C;
  const { $, $$, esc } = C;
  const KEY = 'grades';

  const pct = (w) => { const m = String(w).match(/(\d+(?:\.\d+)?)\s*%/); return m ? +m[1] : 0; };
  // where you stand: the weighted average of what is graded, and the average you need on what is left
  C.gradeStatus = function (cid) {
    const rows = (C.data.vault().planner.weights || {})[cid] || [];
    const g = (C.store.get(KEY, {}) || {})[cid] || {};
    let done = 0, earned = 0, total = 0;
    rows.forEach(([name, w]) => {
      const wt = pct(w);
      total += wt;
      const v = g[name];
      if (v != null && v !== '' && !isNaN(+v)) { done += wt; earned += (wt * +v) / 100; }
    });
    const target = g._target != null ? +g._target : 90;
    const left = total - done;
    const need = left > 0 ? ((target / 100) * total - earned) / left * 100 : null;
    return { rows, g, done, earned, total, target, current: done ? (100 * earned) / done : null, need };
  };

  C.routes.grades = {
    title: 'Grades',
    render(main) {
      const courses = (C.data.vault().courses || []).filter((c) => ((C.data.vault().planner.weights || {})[c.id] || []).length);
      main.innerHTML =
        '<div class="page page--narrow"><div class="phead"><div><h1>Grades</h1><p>Components and weights from planner.md. Enter scores as percentages; leave blank what is not graded yet.</p></div></div>' +
        courses.map((c) => {
          const s = C.gradeStatus(c.id);
          return '<section class="grade c-' + c.id + '" data-c="' + c.id + '"><div class="grade__head"><h2><span class="ctag">' + esc(c.code) + '</span> ' + esc(c.name) + '</h2>' +
            '<dl class="stats"><div><dt>So far</dt><dd>' + (s.current == null ? 'not yet' :s.current.toFixed(1) + '%') + '</dd></div>' +
            '<div><dt>Graded</dt><dd>' + s.done + ' of ' + s.total + '%</dd></div>' +
            '<div><dt>Needed on the rest for ' + s.target + '%</dt><dd class="' + (s.need != null && s.need > 100 ? 'is-hard' : '') + '">' + (s.need == null ? 'done' : s.need <= 0 ? 'already there' : s.need.toFixed(1) + '%') + '</dd></div></dl></div>' +
            '<table class="history grade__table"><thead><tr><th scope="col">Component</th><th scope="col">Weight</th><th scope="col">Your score (%)</th><th scope="col">Points</th></tr></thead><tbody>' +
            s.rows.map(([name, w]) => {
              const v = s.g[name];
              const has = v != null && v !== '';
              return '<tr><td>' + esc(name) + '</td><td>' + esc(w) + '</td><td><label class="visually-hidden" for="g-' + c.id + '-' + C.hash(name) + '">' + esc(name) + ' score</label><input class="grade__in" id="g-' + c.id + '-' + C.hash(name) + '" type="number" inputmode="decimal" min="0" max="120" step="0.1" data-name="' + esc(name) + '" value="' + (has ? esc(v) : '') + '"></td><td>' + (has ? ((pct(w) * +v) / 100).toFixed(1) : '') + '</td></tr>';
            }).join('') + '</tbody></table>' +
            '<p class="grade__target"><label>Target <input class="grade__in" type="number" min="50" max="100" step="1" data-name="_target" value="' + s.target + '">%</label></p></section>';
        }).join('') + '</div>';
      $$('.grade__in', main).forEach((inp) => (inp.onchange = () => {
        const cid = inp.closest('[data-c]').dataset.c;
        const name = inp.dataset.name;
        const v = inp.value.trim();
        if (v !== '' && (isNaN(+v) || +v < 0 || +v > 120)) { inp.setAttribute('aria-invalid', 'true'); return; }
        inp.removeAttribute('aria-invalid');
        C.store.update(KEY, {}, (g) => { g[cid] = g[cid] || {}; if (v === '') delete g[cid][name]; else g[cid][name] = +v; g._t = Date.now(); });
        C.render();
      }));
    },
  };
})();
