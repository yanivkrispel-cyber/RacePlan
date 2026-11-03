// Tests for the watch plan (src/watch.jsx): condensing a plan into a few long blocks, the bands, the
// GPS-drift lengths, the pace band, the rehearsal and the Garmin Training API workout.
// Run with: node test/watch.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { expected, PAIRS } from '../build/sync-functions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error(`  FAIL: ${msg}`); } }
function eq(a, b, msg) { assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function near(a, b, msg, eps = 0.01) { assert(Math.abs(a - b) < eps, `${msg} — expected ~${b}, got ${a}`); }

// load as the browser does (window) and as the functions do (module.exports)
const src = readFileSync(join(ROOT, 'src', 'watch.jsx'), 'utf8');
const win = {};
new Function('window', 'module', src)(win, undefined);
const W = win.WATCHPLAN;
const mod = { exports: {} };
new Function('window', 'module', src)(undefined, mod);
assert(W && typeof W.toGarminWorkout === 'function', 'window.WATCHPLAN is set in the browser');
assert(typeof mod.exports.toGarminWorkout === 'function', 'module.exports is set for the functions');

console.log('\n── the functions copy is current ──');
for (const [s, d] of PAIRS) {
  eq(readFileSync(join(ROOT, d), 'utf8'), expected(s), `${d} matches ${s} (run node build/sync-functions.mjs)`);
}

// A marathon in 1 km segments on a course with one climb (km 20 to 24, +80 m) and one descent
// (km 30 to 33, -60 m), grade-adjusted as gpx.jsx buildPlanSegments does (14 s/km per %).
const profile = [];
for (let d = 0; d <= 42.2 + 1e-9; d = Math.round((d + 0.1) * 10) / 10) {
  let ele = 20;
  if (d > 20) ele += Math.min(d - 20, 4) * 20;
  if (d > 30) ele -= Math.min(d - 30, 3) * 20;
  profile.push({ d, ele });
}
const eleAt = (d) => profile.reduce((p, x) => (x.d <= d + 1e-9 ? x : p)).ele;
const marathon = [];
for (let a = 0; a < 42.2 - 1e-9; a += 1) {
  const b = Math.min(42.2, a + 1);
  const dist = Math.round((b - a) * 100) / 100;
  const grade = ((eleAt(b) - eleAt(a)) / (dist * 1000)) * 100;
  marathon.push({ distance: dist, paceSec: Math.round(300 + Math.max(-22, Math.min(48, grade * 14))) });
}
const timeOf = (ss) => ss.reduce((t, s) => t + s.distance * s.paceSec, 0);
const distOf = (ss) => Math.round(ss.reduce((t, s) => t + s.distance, 0) * 100) / 100;

console.log('\n── blocksFor ──');
eq(W.blocksFor(5), 2, '5K: 2 blocks');
eq(W.blocksFor(10), 3, '10K: 3 blocks');
eq(W.blocksFor(21.1), 5, 'half: 5 blocks');
eq(W.blocksFor(42.2), 7, 'marathon: 7 blocks');
eq(W.blocksFor(0), 1, 'nothing: 1');

console.log('\n── condense ──');
{
  const M = { merge: true }; // the council's merging, kept as an option
  const bl = W.condense(marathon, profile, M);
  assert(bl.length >= 3 && bl.length <= 7, `marathon condenses to 3..7 blocks (got ${bl.length})`);
  near(bl.reduce((t, b) => t + b.time, 0), timeOf(marathon), 'total time is kept exactly', 1e-6);
  near(bl[bl.length - 1].endKm, 42.2, 'the blocks end at the finish');
  eq(bl[0].startKm, 0, 'the first block starts at 0');
  for (let i = 1; i < bl.length; i++) near(bl[i].startKm, bl[i - 1].endKm, `block ${i} starts where ${i - 1} ends`);
  const climb = bl.find((b) => b.kind === 'climb');
  assert(climb && climb.startKm >= 19 && climb.endKm <= 25, `the climb is its own block near km 20 to 24 (${climb && climb.startKm}-${climb && climb.endKm})`);
  assert(climb && climb.gain >= 75, 'the climb block carries its gain');
  assert(bl.some((b) => b.kind === 'descent'), 'the descent is its own block');

  // an even plan on a flat course collapses to one block
  const flat = Array.from({ length: 10 }, () => ({ distance: 1, paceSec: 300 }));
  eq(W.condense(flat, null, M).length, 1, 'an even flat 10K is one block');
  // a negative split keeps its shape within the cap
  const neg = Array.from({ length: 10 }, (_, i) => ({ distance: 1, paceSec: 310 - i * 2 }));
  const nb = W.condense(neg, null, M);
  assert(nb.length >= 2 && nb.length <= 3, `a negative-split 10K: 2..3 blocks (got ${nb.length})`);
  assert(nb[0].paceSec > nb[nb.length - 1].paceSec, 'the first block is slower than the last');
  // a tiny tail never survives as its own block
  const tail = [{ distance: 5, paceSec: 300 }, { distance: 4.95, paceSec: 290 }, { distance: 0.05, paceSec: 250 }];
  assert(W.condense(tail, null, M).every((b) => b.distance >= 1), 'a 50 m tail is merged into its neighbour');
  eq(W.condense([], null).length, 0, 'no segments: no blocks');
  eq(W.condense(marathon, profile, { merge: true, maxBlocks: 3 }).length <= 3, true, 'maxBlocks caps the count');
}

console.log("\n── default: the runner's segments as they are ──");
{
  const one = W.condense(marathon, profile);
  eq(one.length, marathon.length, 'one block per plan segment (43), nothing merged');
  one.forEach((b, i) => { near(b.distance, marathon[i].distance, `block ${i} keeps its distance`); near(b.paceSec, marathon[i].paceSec, `block ${i} keeps its pace`, 1e-9); });
  const same = Array.from({ length: 4 }, () => ({ distance: 5, paceSec: 300 }));
  eq(W.condense(same, null).length, 4, 'four segments at the same pace stay four');
  const tiny = [{ distance: 5, paceSec: 300 }, { distance: 0.05, paceSec: 280 }];
  eq(W.condense(tiny, null).length, 2, 'a 50 m segment the runner made stays');
  near(W.condense(marathon, profile).reduce((t, b) => t + b.time, 0), timeOf(marathon), "the time is the plan's", 1e-6);
}

console.log('\n── watchBlocks: bands, drift, cues ──');
{
  const M = { merge: true };
  const wb = W.watchBlocks(W.condense(marathon, profile, M));
  const first = wb[0], last = wb[wb.length - 1];
  eq(first.fastSec, Math.round(first.paceSec), 'block 1 is "not faster than" its pace');
  eq(first.slowSec, Math.round(first.paceSec + 60), 'slow end opened by 60 s/km (only "too fast" alerts)');
  const mid = wb.find((b, i) => i > 0 && i < wb.length - 1 && b.kind === 'flat');
  if (mid) eq(mid.fastSec, Math.round(mid.paceSec - 5), 'a flat block: 5 s/km on the fast side');
  const climb = wb.find((b) => b.kind === 'climb');
  assert(climb && climb.tolSec > 5 && climb.tolSec <= 15, `a climb gets a wider band, capped at 15 (${climb && climb.tolSec})`);
  near(first.watchMeters, Math.round(first.distance * 1000 * 1.007), 'distance on the watch: +0.7 % for GPS drift', 1);
  eq(last.open, true, 'the last block is open (ends on the finish)');
  assert(wb.slice(0, -1).every((b) => !b.open), 'only the last block is open');
  eq(first.cue, 'Start: not faster', 'block 1 cue');
  eq(last.cue, 'Finish: all in', 'last block cue');
  eq(climb.cue, 'Climb: hold effort', 'climb cue');
  assert(wb.every((b) => b.cue.length <= 24), 'cues fit 24 characters');
  const own = W.watchBlocks(W.condense(marathon, profile, M), { cues: { 1: 'Bridge: easy' } });
  eq(own[1].cue, 'Bridge: easy', 'a runner-written cue replaces the automatic one');
  const strict = W.watchBlocks(W.condense(marathon, profile, M), { fastOnly: false, firstNotFaster: false, driftPct: 0 });
  eq(strict[0].slowSec, Math.round(strict[0].paceSec + 5), 'fastOnly off: a symmetric ±5 band');
  eq(strict[0].watchMeters, Math.round(strict[0].distance * 1000), 'driftPct 0: the plan distance');
}

console.log('\n── splits (pace band) ──');
{
  const sp = W.splits([{ distance: 10, paceSec: 300 }, { distance: 11.1, paceSec: 290 }], 5);
  eq(sp.map((x) => x.km).join(','), '5,10,15,20,21.1', 'every 5 km and the finish');
  eq(sp[0].sec, 1500, '5 km at 5:00 = 25:00');
  eq(sp[2].sec, 3000 + 5 * 290, '15 km crosses into the second segment');
  eq(sp[sp.length - 1].finish, true, 'the finish is marked');
  eq(sp[sp.length - 1].sec, Math.round(timeOf([{ distance: 10, paceSec: 300 }, { distance: 11.1, paceSec: 290 }])), 'finish = the plan time');
  eq(W.splits(marathon, 5).length, 9, 'a marathon band: 8 marks and the finish');
  eq(W.splits([], 5).length, 0, 'no plan: no band');
}

console.log('\n── rehearsalOf ──');
{
  const r = W.rehearsalOf(marathon, 28);
  near(distOf(r), 28, 'a 28 km rehearsal is the first 28 km');
  eq(r[0].paceSec, marathon[0].paceSec, 'with the race paces');
  near(distOf(W.rehearsalOf(marathon, 100)), 42.2, 'longer than the race: the whole race');
  const half = W.rehearsalOf([{ distance: 3, paceSec: 300 }, { distance: 3, paceSec: 290 }], 4.5);
  eq(half[1].distance, 1.5, 'the last piece is cut');
}

console.log('\n── toGarminWorkout ──');
{
  const plan = { name: 'Tel Aviv Marathon', date: '2027-02-26', segments: marathon, profile };
  const r = W.toGarminWorkout(plan);
  eq(r.problems.length, 0, 'a good plan has no problems');
  const w = r.workout;
  eq(w.sport, 'RUNNING', 'sport RUNNING');
  eq(w.workoutProvider, 'RacePlan', 'provider RacePlan');
  eq(w.segments.length, 1, 'one segment');
  const steps = w.segments[0].steps;
  eq(steps.length, r.blocks.length, 'one step per block');
  assert(steps.length <= 100, 'within Garmin\'s 100 steps');
  steps.forEach((s, i) => eq(s.stepOrder, i + 1, `step ${i + 1} order`));
  assert(steps.every((s) => s.targetType === 'PACE' && s.targetValueLow < s.targetValueHigh), 'pace bands: low (slower) < high (faster), m/s');
  near(steps[0].targetValueHigh, 1000 / r.blocks[0].fastSec, 'high = the fast end in m/s', 0.001);
  eq(steps[0].durationType, 'DISTANCE', 'blocks run by distance');
  eq(steps[0].durationValueType, 'METER', 'in metres');
  eq(steps[steps.length - 1].durationType, 'OPEN', 'the last one is open');
  eq(steps[steps.length - 1].durationValue, null, 'an open step has no value');
  assert(/Goal 3:3\d:\d\d/.test(w.description), `the goal time is in the description (${w.description.split('\n')[0]})`);
  assert(w.description.length <= 500, 'description within 500');
  const meters = steps.slice(0, -1).reduce((t, s) => t + s.durationValue, 0);
  assert(meters < 42200 * 1.007, 'the closed steps end before the drifted finish');

  eq(W.toGarminWorkout({ ...plan, date: '26/02/2027' }).workout, null, 'a bad date is refused');
  eq(W.toGarminWorkout({ ...plan, segments: [] }).workout, null, 'no segments is refused');
  eq(W.toGarminWorkout({ ...plan, segments: [{ distance: 5, paceSec: 60 }] }).workout, null, 'a 1:00 pace is refused');
  eq(W.toGarminWorkout({ ...plan, segments: [{ distance: -1, paceSec: 300 }] }).workout, null, 'a negative distance is refused');
  eq(W.toGarminWorkout(plan, { driftPct: 9 }).workout, null, 'a 9 % drift is refused');
  eq(W.toGarminWorkout({ ...plan, name: '' }).workout.workoutName, 'RacePlan', 'no name: RacePlan');
  eq(W.toGarminWorkout({ ...plan, name: 'x'.repeat(200) }).workout.workoutName.length, 80, 'name cut to 80');
  const tenK = W.toGarminWorkout({ name: '10K', date: '2027-01-01', segments: Array.from({ length: 10 }, (_, i) => ({ distance: 1, paceSec: 300 - i })) });
  eq(tenK.workout.segments[0].steps.length, 10, '10K in 10 planned segments: 10 steps');
  const many = W.toGarminWorkout({ ...plan, segments: Array.from({ length: 101 }, () => ({ distance: 0.4, paceSec: 300 })) });
  eq(many.workout, null, '101 segments: refused (Garmin takes 100)');
  assert(many.problems.some((x) => /100/.test(x)), 'and says why');
  const merged = W.toGarminWorkout(plan, { merge: true });
  assert(merged.workout.segments[0].steps.length <= 7, "merge: true still gives the council's few blocks");
  // the same plan, the same JSON: the server rebuilds exactly what the app previewed
  eq(JSON.stringify(W.toGarminWorkout(plan)), JSON.stringify(mod.exports.toGarminWorkout(plan)), 'browser and functions build the same workout');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
