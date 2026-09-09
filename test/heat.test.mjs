// Tests for the heat/humidity pace-adjustment layer (src/heat-tables.jsx +
// src/heat.jsx). Both files are evaluated against a fake `window`, exactly
// like test/units.test.mjs. Assertions mirror the reference checks from
// HeatRunCalc's test-engine.cjs (same source data, same expected values).
// Run with: node test/heat.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}
function near(a, b, msg, eps = 0.5) { assert(Math.abs(a - b) <= eps, `${msg} — expected ~${b}, got ${a}`); }

const fakeWin = {};
new Function('window', readFileSync(join(SRC, 'heat-tables.jsx'), 'utf8'))(fakeWin);
new Function('window', readFileSync(join(SRC, 'heat.jsx'), 'utf8'))(fakeWin);
const H = fakeWin.RP_HEAT;
assert(!!H, 'window.RP_HEAT defined');
assert(!!fakeWin.RP_HEAT_FINE_TABLE, 'window.RP_HEAT_FINE_TABLE defined');
assert(fakeWin.RP_HEAT_FINE_TABLE.air_temp_c.length === 4646, 'fine grid has 46x101 = 4646 points');

// ═══════════════════════════════════════════════════════════════════════
console.log('── heatHumidityLookup (bilinear grid) ──');
near(H.heatHumidityLookup(9, 50), 0, 'adjustment ~0 at the optimum (9°C/50%)', 0.01);
assert(H.heatHumidityLookup(1, 60) < 0, 'cold (1°C/60%) still shows a small slowdown');
assert(H.heatHumidityLookup(30, 80) < H.heatHumidityLookup(30, 40),
  'humid heat (80%) hurts more than dry heat (40%) at the same temperature');

console.log('── adjustedPaceSec (effort mode: ideal pace -> actual pace in the heat) ──');
// Doc example: 7:00/mi ideal -> ~7:12-7:13/mi actual at heat index 80°F (26.67°C
// at ~59% RH, per the source app's HI-to-temp/RH reference point). We drive the
// humidity path directly instead of the heat-index path (the recommended input
// per docs/HEAT.md §11), so we just assert the same order of magnitude here.
const idealSecPerKm = (7 * 60) / 1.609344; // 7:00/mi -> sec/km
const hot = H.adjustedPaceSec(idealSecPerKm, 30, 70);
assert(hot > idealSecPerKm, 'hot+humid conditions slow the pace down (never speeds it up)');
const deltaPerMi = (hot - idealSecPerKm) * 1.609344;
assert(deltaPerMi > 5 && deltaPerMi < 60, `slowdown at 30°C/70% is a plausible few-sec/mi to under a minute (got ${deltaPerMi.toFixed(1)}s/mi)`);

console.log('── paceDeltaSec ──');
near(H.paceDeltaSec(300, 9, 50), 0, 'no delta at the optimum', 0.05);
assert(H.paceDeltaSec(300, 35, 85) > H.paceDeltaSec(300, 25, 85), 'hotter -> bigger delta, holding humidity fixed');
assert(H.paceDeltaSec(300, 9, 50) >= 0, 'delta is never negative (never predicts a speed-up)');

console.log('── warnings (out-of-distribution guard rails) ──');
assert(H.warnings(35, 50).includes('extreme-heat'), 'flags extreme heat >= 32°C');
assert(H.warnings(-2, 50).includes('freezing'), 'flags freezing <= 0°C');
assert(H.warnings(20, 10).includes('low-humidity'), 'flags very low humidity <= 25%');
assert(H.warnings(9, 50).length === 0, 'no warnings in ordinary conditions');

console.log('── heatIndexLookup (fallback 1D path) ──');
assert(typeof H.heatIndexLookup === 'function', 'heat-index interpolator is exposed');
near(H.heatIndexLookup(9), 0, 'heat-index path also ~0 near the optimum temperature', 0.05);

// ── Summary ────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`heat: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
