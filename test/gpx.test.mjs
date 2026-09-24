// Tests for the GPX-derived per-segment wind classification (src/gpx.jsx).
// The module is evaluated against a fake `window`; only the pure helper is
// exercised (parsing/DOM bits need a browser and are covered by the app itself).
// Run with: node test/gpx.test.mjs

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

const win = { round2: (n) => Math.round(n * 100) / 100, clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)) };
new Function('window', `${readFileSync(join(SRC, 'gpx.jsx'), 'utf8')}`)(win);

const { computeSegmentWind } = win;

// A straight ~11 km course running due north from the equator, split into
// two 5+ km segments — long enough to clear the haversine noise floor.
const track = [[0, 0], [0.05, 0], [0.1, 0]];
const rows = [{ cumDist: 5.5 }, { cumDist: 11 }];

console.log('\n── computeSegmentWind ──');
{
  const r = computeSegmentWind(track, rows, 0, 25); // wind FROM the north → blows south, against a northbound runner
  eq(r.length, 2, 'one entry per row');
  eq(r[0].kind, 'head', 'wind from the north is a headwind running north');
  eq(r[1].kind, 'head', 'same for every segment of a straight course');
}
{
  const r = computeSegmentWind(track, rows, 180, 25); // wind FROM the south → blows north, with the runner
  eq(r[0].kind, 'tail', 'wind from the south is a tailwind running north');
}
{
  const r = computeSegmentWind(track, rows, 90, 25); // wind FROM the east → blows west, across the runner
  eq(r[0].kind, 'cross', 'wind from the east is a crosswind running north');
}
{
  const r = computeSegmentWind(track, rows, 0, 10); // below the "runner actually feels it" threshold
  eq(r, null, 'a light breeze produces no classification at all');
}
{
  eq(computeSegmentWind(null, rows, 0, 25), null, 'no track → null');
  eq(computeSegmentWind([[0, 0]], rows, 0, 25), null, 'a single-point track → null');
}

console.log(`\n${'='.repeat(60)}\ngpx: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
