// Logic checks for Carrel, no browser needed:  node tests/logic.test.mjs
// Loads the real app scripts into a minimal fake window, then tests scoring, scheduling, plan and exam scope.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const noop = () => {};
const el = () => ({ addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {} });
const store = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop, Date, Math, JSON, Promise, Set, Map,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] },
  location: { hash: '', protocol: 'http:' }, history: { replaceState: noop },
  navigator: {}, matchMedia: () => ({ matches: false }), requestAnimationFrame: (f) => f(),
  document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], createElement: el, createTreeWalker: () => ({ nextNode: () => false }), documentElement: el(), head: el(), body: el(), readyState: 'complete' },
  addEventListener: noop, fetch: async () => { throw new Error('offline'); },
  MutationObserver: class { observe() {} }, queueMicrotask: (f) => f(), CSS: { escape: (x) => x },
};
ctx.window = ctx;
vm.createContext(ctx);
// a fresh clone has no generated app/data/courses.js until Carrel first starts: use the shipped seed instead
const pathOf = (f) => (f === 'data/courses.js' && !fs.existsSync(path.join(root, f)) ? path.join(root, '..', 'build', 'seed', 'courses.js') : path.join(root, f));
if (!fs.existsSync(path.join(root, 'data', 'vault.js'))) { console.error('Run install.py first: it writes app/data/vault.js from your planner.'); process.exit(1); }
const load = (f) => vm.runInContext(fs.readFileSync(pathOf(f), 'utf8'), ctx, { filename: f });
['data/courses.js', 'data/vault.js', 'js/core.js', 'js/claude.js', 'js/study.js', 'js/plan.js', 'js/calendar.js', 'js/tasks.js', 'js/recovery.js', 'js/grades.js', 'js/backplan.js', 'js/notes.js', 'js/sync.js'].forEach(load);
const C = ctx.C;
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } };
const reset = () => { Object.keys(store).forEach((k) => delete store[k]); C.store.set('progress', {}); C.store.set('recovery', {}); C.store.set('plan', null); C.store.set('tasks', {}); };

test('dates: addDays and daysBetween cross a month end', () => {
  assert.equal(C.addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(C.daysBetween('2026-10-29', '2026-11-04'), 6);
});

test('the ML Ops midterm override lands on Wed Nov 4', () => {
  const m = C.deadlines().find((d) => d.course === '095' && /^Midterm I$/.test(d.title));
  assert.equal(m.date, '2026-11-04');
  assert.equal(m.moved.from, '2026-11-02');
});

test('exam scope: OM Midterm 1 covers L1 to L12, not L13 or L14', () => {
  const ex = C.deadlines().find((d) => d.course === 'c57' && d.title === 'Midterm 1');
  const labels = C.study.examUnits(ex).map((id) => C.data.unit('c57', id).label);
  assert.ok(labels.includes('L1') && labels.includes('L12'));
  assert.ok(!labels.includes('L13') && !labels.includes('L14'));
});

test('review queue: nothing due on a fresh start, a due entry counts', () => {
  reset();
  assert.equal(C.study.dueCount('c57'), 0);
  const u = C.data.unit('c57', 'l1');
  C.store.set('progress', { [C.study.qkey('c57', 'l1', u.quiz[0])]: { box: 0, last: 0, due: C.today() }, [C.study.qkey('c57', 'l1', u.quiz[1])]: { box: 3, last: 1, due: C.addDays(C.today(), 7) } });
  assert.equal(C.study.dueCount('c57'), 1);
});

test('sessions survive a question being inserted ahead of them', () => {
  const u = C.data.unit('c57', 'l2');
  const item = C.study.item('c57', 'l2', u.quiz[5], 5, Math.random);
  u.quiz.unshift({ q: 'An inserted question', o: ['a', 'b', 'c', 'd'], a: 0, mine: true });
  const [r] = C.study.resolve('c57', [item]);
  assert.equal(r.i, 6);
  assert.equal(u.quiz[r.i].q, u.quiz[6].q);
  u.quiz.shift();
  const gone = C.study.resolve('c57', [Object.assign({}, item, { k: 'no-such-key' })]);
  assert.equal(gone.length, 0);
});

test('recovery: 8 h of steady sleep with no training scores high', () => {
  reset();
  const sleep = {};
  for (let k = 0; k < 7; k++) sleep[C.addDays(C.today(), -k)] = { bed: '23:00', wake: '07:00', q: 4 };
  C.store.set('recovery', { sleep, workouts: [], checkins: {} });
  const x = C.recovery.compute(C.today());
  assert.ok(x.sleep.h === 8, 'hours ' + x.sleep.h);
  assert.ok(x.recovery >= 85, 'recovery ' + x.recovery);
});

test('recovery: short nights and a training spike score low', () => {
  reset();
  const sleep = {}, workouts = [];
  for (let k = 0; k < 7; k++) sleep[C.addDays(C.today(), -k)] = { bed: '01:30', wake: '06:00', q: 2 };
  for (let k = 7; k < 28; k++) workouts.push({ id: 'w' + k, date: C.addDays(C.today(), -k), min: 30, rpe: 4 });
  [1, 2, 3].forEach((k) => workouts.push({ id: 'big' + k, date: C.addDays(C.today(), -k), min: 120, rpe: 9 }));
  C.store.set('recovery', { sleep, workouts, checkins: {} });
  const x = C.recovery.compute(C.today());
  assert.ok(x.recovery < 50, 'recovery ' + x.recovery);
  assert.ok(x.load.acwr > 1.3, 'acwr ' + x.load.acwr);
});

test('recovery: an after-midnight bedtime counts as a short night, not a 20-hour one', () => {
  assert.equal(C.recovery.hours({ bed: '00:30', wake: '07:30' }), 7);
  assert.equal(C.recovery.hours({ bed: '23:30', wake: '06:30' }), 7);
});

test('plan: a mock exam the day before each exam, drills before that', () => {
  reset();
  const days = C.plan.get();
  const ex = C.deadlines().find((d) => d.course === 'c57' && d.title === 'Midterm 1');
  if (ex.date <= C.today()) return;
  const eve = days[C.addDays(ex.date, -1)] || [];
  assert.ok(eve.some((x) => x.kind === 'mock' && x.course === 'c57'));
  const drills = Object.keys(days).filter((d) => d < C.addDays(ex.date, -1)).flatMap((d) => days[d]).filter((x) => x.kind === 'drill' && x.course === 'c57');
  const covered = new Set(drills.flatMap((x) => x.units));
  C.study.examUnits(ex).filter((id) => C.data.unit('c57', id).quiz.length).forEach((id) => assert.ok(covered.has(id), 'not planned: ' + id));
});

test('merging saved lists keeps every answer-log row and dedupes objects by id', () => {
  const a = [['2026-10-29', 'c57', 1, 1], ['2026-10-29', 'c57', 0, 2]];
  const b = [['2026-10-29', 'c57', 0, 2], ['2026-10-30', '095', 1, 3]];
  assert.equal(C.mergeLists(a, b).length, 3);
  assert.equal(C.mergeLists([{ id: 'x', title: 'old' }], [{ id: 'x', title: 'old' }, { id: 'y' }]).length, 2);
  assert.equal(C.mergeLists([{ at: 5, n: 1 }], [{ at: 5, n: 1 }, { at: 6, n: 2 }]).length, 2);
});

test('grades: what you need on the rest of Optimization Methods', () => {
  reset();
  C.store.set('grades', { c57: { 'Homework (5 × 4%)': 92 } });
  const g = C.gradeStatus('c57');
  assert.equal(g.total, 100);
  assert.equal(g.done, 20);
  assert.equal(Math.round(g.need * 10) / 10, 89.5); // (90 - 18.4) / 80
});

test('heavy days: the Dec 7 term-project crunch is flagged', () => {
  const t = C.today();
  if (t >= '2026-12-07') return;
  const days = C.backplan.heavy(60).map((d) => d.date);
  assert.ok(days.includes('2026-12-07') && days.includes('2026-12-08'), days.join(','));
});

test('tasks: checking one moves it after every open task', () => {
  reset();
  const all = C.tasks.all(14);
  assert.ok(all.length > 2);
  C.tasks.toggle(all[0].id);
  const sorted = C.tasks.sorted(C.tasks.all(14));
  assert.equal(sorted[sorted.length - 1].id, all[0].id);
  assert.ok(sorted.slice(0, -1).every((x) => !x.doneAt));
});

test('your Midterm 1 practice set is written practice inside the exam scope', () => {
  const u = C.data.course('c57').units.find((x) => x.label === 'PS');
  assert.ok(u && u.written.length >= 10, 'practice set missing');
  assert.ok(u.written.every((w) => w.q && w.m), 'a problem lost its question or answer');
  const ex = C.deadlines().find((d) => d.course === 'c57' && d.title === 'Midterm 1');
  assert.ok(C.study.examUnits(ex).includes(u.id));
  // the L12-L13 quiz splits by its own scope note: L12 items in Midterm 1, L13 items later
  const mine = (label) => C.data.course('c57').units.find((x) => x.label === label).written.filter((w) => w.mine).map((w) => w.src.split(', ').pop());
  assert.ok(mine('L12').includes('E1') && !mine('L12').includes('E6'));
  assert.ok(mine('L13').includes('E6'));
});

test("Claude's written grade is read in the forms it comes in", () => {
  const s = (t) => JSON.stringify(C.study.scoreOf(t));
  assert.equal(s('Score: 7 / 10'), '[7,10]');
  assert.equal(s('**Score: 7** / 10'), '[7,10]');
  assert.equal(s('Score: **7.5/10**'), '[7.5,10]');
  assert.equal(s('Score: 7 out of 10'), '[7,10]');
  assert.equal(s('Verdict: mostly right'), 'null');
});

test('two devices: progress merges answer by answer, and an undo is not undone by the other copy', () => {
  const phone = { 'c57:l1:a': { last: 1, at: 200 }, 'c57:l1:b': { last: 0, at: 300 }, _t: 300 };
  const pc = { 'c57:l1:a': { last: 0, at: 100 }, 'c57:l1:c': { last: 1, at: 250 }, 'c57:l1:b': { last: 1, at: 150 }, _t: 250 };
  const m = C.mergeEntries(phone, pc);
  assert.equal(m['c57:l1:a'].last, 1);
  assert.equal(m['c57:l1:b'].last, 0);
  assert.equal(m['c57:l1:c'].last, 1, 'the PC answer the phone never saw is kept');
  // the phone undid c (no earlier answer): its marker beats the PC's older copy
  const undone = { 'c57:l1:a': { last: 1, at: 200 }, _gone: { 'c57:l1:c': Date.now() }, _t: Date.now() };
  assert.ok(!('c57:l1:c' in C.mergeEntries(undone, pc)) && !('c57:l1:c' in C.mergeEntries(pc, undone)));
  // answering it again later beats the marker
  const again = Object.assign({}, pc, { 'c57:l1:c': { last: 0, at: Date.now() + 1000 } });
  assert.equal(C.mergeEntries(undone, again)['c57:l1:c'].last, 0);
});

test('Canvas: a planner deadline is matched, not duplicated; submitted counts as done and can be re-opened', () => {
  reset();
  const hw = C.deadlines().find((d) => d.course === 'c57' && /^HW4/.test(d.title));
  C.sync.canvas = { items: [
    { id: 'cv-assignment-1', title: 'Homework 4: Optimization under Uncertainty', date: hw.date, time: '23:59', kind: 'assignment', course: 'c57', url: 'https://canvas.mit.edu/x', done: false },
    { id: 'cv-assignment-2', title: 'Project check-in survey', date: C.addDays(C.today(), 1), time: '12:00', kind: 'assignment', course: '095', url: 'https://canvas.mit.edu/y', done: true },
    { id: 'cv-calendar_event-3', title: 'Recitation', date: C.today(), kind: 'event', course: 'c57', done: false },
  ] };
  C.sync.at = Date.now();
  const all = C.deadlines();
  assert.equal(all.filter((d) => /Homework 4|HW4/.test(d.title)).length, 1, 'HW4 duplicated');
  assert.equal(all.find((d) => d.id === hw.id).canvas.url, 'https://canvas.mit.edu/x');
  assert.ok(all.some((d) => d.id === 'cv-assignment-2') && !all.some((d) => d.id === 'cv-calendar_event-3'));
  assert.ok(C.isDone('cv-assignment-2'));
  C.tasks.toggle('cv-assignment-2');
  assert.ok(!C.isDone('cv-assignment-2'), 're-opened here');
  C.tasks.toggle('cv-assignment-2');
  assert.ok(C.isDone('cv-assignment-2'));
  C.sync.canvas = null; C.sync.at = Date.now();
});

test('flagging a question flags its topic until no question in it is flagged', () => {
  reset();
  C.store.set('flags', {});
  const u = C.data.course('c57').units.find((x) => x.topics.length > 1 && x.quiz.filter((q) => q.t === x.quiz[0].t).length > 1);
  const [a, b] = u.quiz.filter((q) => q.t === u.quiz[0].t);
  assert.ok(C.study.toggleFlag('c57', u, a));
  assert.ok(C.study.topicFlagged('c57', u.id, a.t));
  assert.ok(!C.study.topicFlagged('c57', u.id, u.topics.findIndex((_, i) => i !== a.t)));
  C.study.toggleFlag('c57', u, b);
  assert.equal(C.study.flagCount('c57'), 2);
  assert.ok(!C.study.toggleFlag('c57', u, a));
  assert.ok(C.study.topicFlagged('c57', u.id, a.t), 'topic stays flagged while b is');
  C.study.toggleFlag('c57', u, b);
  assert.ok(!C.study.topicFlagged('c57', u.id, a.t));
  assert.equal(C.study.flagCount('c57'), 0);
});

test('dollar prices stay text; real math still counts as math', () => {
  const spans = (t) => t.match(new RegExp(C.MATH1, 'g')) || [];
  assert.deepEqual(spans('Unit cost is $5 for the first 10 units and $3 beyond.'), []);
  assert.deepEqual(spans('greedy $11,389 vs LP $12,771 (+12%)'), []);
  assert.deepEqual(spans('capacity dual −2.12 $/h, fine demand dual +14.96 $/kg'), []);
  assert.deepEqual(spans('so $x + y \\le 3$ holds, and $z$ too'), ['$x + y \\le 3$', '$z$']);
  assert.deepEqual(spans('$|r_{(q)}| = $ median of $r_i^2$'), ['$|r_{(q)}| = $', '$r_i^2$']);
  assert.deepEqual(spans('cost is $2^n$ for n items'), ['$2^n$']);
});

test('your notes sit with the lectures they cover', () => {
  const titles = (cid, label) => C.notes.forUnit(cid, C.data.course(cid).units.find((u) => u.label === label)).map((n) => n.title);
  assert.ok(titles('095', 'L10').includes('Lec10 Cheat Sheet'));
  assert.ok(titles('095', 'L10').includes('Flashcards (Lec 8-11)'));
  assert.ok(!titles('095', 'L3').includes('Lec10 Cheat Sheet'));
  assert.ok(titles('c57', 'L8').includes('L8 Network Flow Review'));
  assert.ok(titles('c57', 'PE').includes('Midterm 1 Practice Exam Breakdown'));
  // names Rec 4 and 5, which 15.C57 has no sets for: placed by the L5 slides it cites instead
  assert.ok(titles('c57', 'L5').includes('Recitations 4-5 Review'));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some failed' : ''));
