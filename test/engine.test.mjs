// Tests for the pacing engine's total-distance lock (src/engine.jsx).
// The module is evaluated against a fake `window`; only the pure helpers are
// exercised (useRacePlan needs React and is covered by the app itself).
// Run with: node test/engine.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}
function eq(a, b, msg) { assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function near(a, b, msg, eps = 0.005) {
  assert(Math.abs(a - b) < eps, `${msg} — expected ~${b}, got ${a}`);
}

const win = {};
new Function('window', 'React', `${readFileSync(join(SRC, 'engine.jsx'), 'utf8')}`)(win, {});

const { settleRemainder, withDistance, lockedSegmentMax, computePlan, round2 } = win;
const total = (ss) => round2(ss.reduce((a, s) => a + s.distance, 0));
// Four 5 km segments + a 2.2 km tail = a 22.2 km course.
const mk = () => [
  { id: 'a', distance: 5, paceSec: 300 },
  { id: 'b', distance: 5, paceSec: 300 },
  { id: 'c', distance: 5, paceSec: 300 },
  { id: 'd', distance: 5, paceSec: 300 },
  { id: 'e', distance: 2.2, paceSec: 300 },
];
const T = 22.2;

console.log('\n── settleRemainder ──');
{
  const already = mk();
  assert(settleRemainder(already, T) === already, 'already settled → same array (no re-render churn)');

  const drifted = mk();
  drifted[4].distance = 9;
  near(total(settleRemainder(drifted, T)), T, 'a drifted tail is pulled back to the target');
  near(settleRemainder(drifted, T)[4].distance, 2.2, 'tail becomes target − head');

  const unlocked = mk();
  assert(settleRemainder(unlocked, 0) === unlocked, 'no target → passthrough');
  // Deleting down to one segment must not quietly drop the lock — that lone
  // segment simply is the course.
  const one = [{ id: 'a', distance: 5, paceSec: 300 }];
  near(settleRemainder(one, T)[0].distance, T, 'a lone segment takes the whole target');
  const exact = [{ id: 'a', distance: T, paceSec: 300 }];
  assert(settleRemainder(exact, T) === exact, 'a lone segment already at the target is untouched');
  assert(settleRemainder([], T).length === 0, 'an empty list is a no-op');

  // Head already over the target: leave it alone rather than produce a
  // zero/negative tail — the callers clamp so this only reaches restored plans.
  const over = [
    { id: 'a', distance: 30, paceSec: 300 },
    { id: 'b', distance: 1, paceSec: 300 },
  ];
  assert(settleRemainder(over, T) === over, 'head over the target → untouched');
}

console.log('── withDistance (locked) ──');
{
  const grown = withDistance(mk(), 'b', 6.2, T);
  near(grown[1].distance, 6.2, 'the edited segment takes the new value');
  near(grown[2].distance, 5, 'the segments between it and the tail are untouched');
  near(grown[4].distance, 1, 'the tail absorbs the difference');
  near(total(grown), T, 'total distance is unchanged');

  const shrunk = withDistance(mk(), 'a', 2, T);
  near(shrunk[0].distance, 2, 'shrinking works too');
  near(shrunk[4].distance, 5.2, 'the tail grows by what was freed');
  near(total(shrunk), T, 'total still unchanged');

  const paces = withDistance(mk(), 'b', 6.2, T).map((s) => s.paceSec);
  eq(paces.join(','), '300,300,300,300,300', 'paces are never touched by a distance edit');

  const tail = mk();
  assert(withDistance(tail, 'e', 4, T) === tail, 'the remainder row itself is read-only');
  const lone = [{ id: 'a', distance: T, paceSec: 300 }];
  assert(withDistance(lone, 'a', 5, T) === lone, 'a lone locked segment is read-only too');

  // Clamped: 'b' can grow only until the tail hits its 0.05 minimum.
  const maxed = withDistance(mk(), 'b', 50, T);
  near(maxed[1].distance, 7.15, 'an over-long edit is clamped (22.2 − 15 − 0.05)');
  near(maxed[4].distance, 0.05, 'the tail keeps its minimum');
  near(total(maxed), T, 'total holds even at the clamp');
  near(lockedSegmentMax(mk(), 'b', T), 7.15, 'lockedSegmentMax reports that ceiling');
  eq(lockedSegmentMax(mk(), 'e', T), 0, 'no ceiling for the remainder row');
  eq(lockedSegmentMax(mk(), 'b', 0), 0, 'no ceiling without a lock');
}

console.log('── withDistance (unlocked) ──');
{
  const free = withDistance(mk(), 'b', 6.2, 0);
  near(free[1].distance, 6.2, 'unlocked edit applies');
  near(free[4].distance, 2.2, 'the tail is left alone');
  near(total(free), 23.4, 'unlocked, the total moves with the edit');

  const big = withDistance(mk(), 'b', 500, 0);
  near(big[1].distance, 99, 'unlocked still clamps at the 99 km ceiling');
  const tiny = withDistance(mk(), 'b', -3, 0);
  near(tiny[1].distance, 0.05, 'and at the 0.05 km floor');

  const orphan = mk();
  assert(withDistance(orphan, 'nope', 5, T) === orphan, 'an unknown id is a no-op');
  const same = mk();
  assert(withDistance(same, 'b', 5, T) === same, 'a no-op edit returns the same array');
}

console.log('── plan totals stay consistent ──');
{
  const edited = withDistance(withDistance(mk(), 'a', 7, T), 'c', 3, T);
  near(computePlan(edited).totalDist, T, 'two locked edits in a row still total the course');
  near(edited[4].distance, 2.2, 'the tail nets out to where it started');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`engine: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
