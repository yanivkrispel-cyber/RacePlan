// Function tests for RacePaln pure logic (engine.jsx + gpx.jsx)
// Run with: node test/functions.test.mjs

import { readFileSync } from 'fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}
function approx(a, b, eps = 0.001) { return Math.abs(a - b) < eps; }
function eq(a, b, msg) { assert(a === b, `${msg} — expected ${b}, got ${a}`); }

// ── extract pure functions from engine.jsx by evaluating in a sandbox ─────
const engineSrc = readFileSync(new URL('../src/engine.jsx', import.meta.url), 'utf8');
const gpxSrc = readFileSync(new URL('../src/gpx.jsx', import.meta.url), 'utf8');

// Minimal stubs for browser globals the modules touch
const win = {};
const fakeDoc = { getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild() {} }, getElementsByTagName: () => [] };

// Build a function body that declares everything, stripping window assignments
const engineBody = engineSrc
  .replace(/const \{[^}]+\} = window;/g, '')
  .replace(/Object\.assign\(window,[^;]+\);/g, '')
  .replace(/localStorage/g, 'fakeLS')
  .replace(/React\./g, 'fakeReact.');

const gpxBody = gpxSrc
  .replace(/const \{[^}]+\} = window;/g, '')
  .replace(/Object\.assign\(window,[^;]+\);/g, '')
  .replace(/new DOMParser\(\)/g, 'fakeDOMParser');

const fakeLS = { store: {}, getItem(k){return this.store[k]??null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
const fakeReact = { useState(){return [null,()=>{}];}, useMemo(){return null;}, useEffect(){}, useRef(){return {current:null};} };
let fakeDOMParser = { parseFromString() { return { querySelector(){return null;}, getElementsByTagName:()=>[] }; } };

const fn = new Function('window','document','localStorage','React','DOMParser','fakeLS','fakeReact','fakeDOMParser',
  `${engineBody}\n${gpxBody}\nreturn { formatPace, formatClock, parsePace, formatKm, round2, clamp, generatePlan, computePlan, defaultSegments, _haversine, _interpolateEle, computeSegmentElevations, buildSegmentsFromGpx };`);

const {
  formatPace, formatClock, parsePace, formatKm, round2, clamp,
  generatePlan, computePlan, defaultSegments,
  _haversine, _interpolateEle, computeSegmentElevations, buildSegmentsFromGpx
} = fn(win, fakeDoc, fakeLS, fakeReact, {parseFromString(){}}, fakeLS, fakeReact, fakeDOMParser);

// ═════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════

console.log('\n── formatPace ──');
eq(formatPace(305), '5:05', '305s -> 5:05');
eq(formatPace(300), '5:00', '300s -> 5:00');
eq(formatPace(0), '0:00', '0s -> 0:00');
eq(formatPace(-5), '0:00', 'negative -> 0:00');
eq(formatPace(3661), '61:01', '3661s -> 61:01');
eq(formatPace(NaN), '0:00', 'NaN -> 0:00');

console.log('── formatClock ──');
eq(formatClock(0), '0:00', '0s -> 0:00');
eq(formatClock(65), '1:05', '65s -> 1:05');
eq(formatClock(3661), '1:01:01', '3661s -> 1:01:01');
eq(formatClock(-10), '0:00', 'negative -> 0:00');

console.log('── parsePace ──');
eq(parsePace('5:00'), 300, '5:00 -> 300');
eq(parsePace('5:05'), 305, '5:05 -> 305');
eq(parsePace('10:30'), 630, '10:30 -> 630');
assert(Number.isNaN(parsePace('abc')), 'invalid string -> NaN');
eq(parsePace(300), 300, 'number passthrough');

console.log('── formatKm ──');
eq(formatKm(42.2), '42.20', '42.2 -> 42.20');
eq(formatKm(5), '5.00', '5 -> 5.00');
eq(formatKm(0.05), '0.05', '0.05 -> 0.05');

console.log('── round2 ──');
eq(round2(3.14159), 3.14, 'pi -> 3.14');
eq(round2(2.005), 2.01, '2.005 -> 2.01');
eq(round2(0), 0, '0 -> 0');

console.log('── clamp ──');
eq(clamp(5, 0, 10), 5, '5 in [0,10] -> 5');
eq(clamp(-3, 0, 10), 0, '-3 -> 0');
eq(clamp(15, 0, 10), 10, '15 -> 10');
eq(clamp(0, 0, 10), 0, 'boundary lo');
eq(clamp(10, 0, 10), 10, 'boundary hi');

console.log('── generatePlan ──');
{
  const p5 = generatePlan(5);
  const dist5 = round2(p5.reduce((s, x) => s + x.distance, 0));
  assert(approx(dist5, 5), `5k plan totals ${dist5} (expected 5)`);
  assert(p5.every(s => s.paceSec >= 165 && s.paceSec <= 540), 'all paces in bounds');
  assert(p5.every(s => s.distance >= 0.05), 'all distances positive');

  const p10 = generatePlan(10);
  const dist10 = round2(p10.reduce((s, x) => s + x.distance, 0));
  assert(approx(dist10, 10), `10k plan totals ${dist10} (expected 10)`);

  const marathon = generatePlan(42.2);
  const distM = round2(marathon.reduce((s, x) => s + x.distance, 0));
  assert(approx(distM, 42.2), `marathon totals ${distM} (expected 42.2)`);
  assert(marathon.length > 5, 'marathon has multiple segments');
}

console.log('── computePlan ──');
{
  const segs = [
    { id: 'a', distance: 1.0, paceSec: 300 },
    { id: 'b', distance: 2.0, paceSec: 310 },
    { id: 'c', distance: 1.0, paceSec: 290 },
  ];
  const plan = computePlan(segs);
  assert(approx(plan.totalDist, 4.0), `totalDist ${plan.totalDist} -> 4.0`);
  // totalTime = 300 + 620 + 290 = 1210
  eq(plan.totalTime, 1210, 'totalTime = 1210');
  assert(approx(plan.avgPace, 1210 / 4), 'avgPace = 302.5');
  eq(plan.rows.length, 3, '3 rows');
  assert(approx(plan.rows[0].cumDist, 1.0), 'row0 cumDist 1.0');
  assert(approx(plan.rows[1].cumDist, 3.0), 'row1 cumDist 3.0');
  assert(approx(plan.rows[2].cumDist, 4.0), 'row2 cumDist 4.0');
  eq(plan.rows[0].segTime, 300, 'row0 segTime');
  eq(plan.rows[1].segTime, 620, 'row1 segTime');
  // zone: avgPace=302.5; delta>5 -> easy, delta<-5 -> fast, else target
  eq(plan.rows[0].zone, 'target', 'row0 zone target (delta=-2.5)');
  eq(plan.rows[1].zone, 'easy', 'row1 zone easy (delta=7.5)');
  eq(plan.rows[2].zone, 'fast', 'row2 zone fast (delta=-12.5)');
}

console.log('── defaultSegments ──');
{
  const d = defaultSegments();
  assert(d.length >= 1, 'has segments');
  const dist = round2(d.reduce((s, x) => s + x.distance, 0));
  assert(approx(dist, 10.1), `default totals ${dist} -> ~10.1`);
  assert(d.every(s => s.id && s.distance > 0 && s.paceSec > 0), 'all valid');
}

console.log('── _haversine ──');
{
  // Same point -> 0
  const a = { lat: 32.0, lon: 34.0 };
  assert(approx(_haversine(a, a), 0), 'same point = 0');
  // Known: ~1 degree lat at 32N ≈ 111 km
  const b = { lat: 33.0, lon: 34.0 };
  const d = _haversine(a, b);
  assert(d > 110000 && d < 112000, `1deg lat ≈ 111km, got ${(d/1000).toFixed(1)}km`);
}

console.log('── _interpolateEle ──');
{
  const prof = [{d:0,ele:100},{d:1,ele:200},{d:2,ele:150}];
  assert(approx(_interpolateEle(prof, 0), 100), 'start');
  assert(approx(_interpolateEle(prof, 1), 200), 'mid point');
  assert(approx(_interpolateEle(prof, 2), 150), 'end');
  assert(approx(_interpolateEle(prof, 0.5), 150), 'halfway 0->1 = 150');
  assert(approx(_interpolateEle(prof, 1.5), 175), 'halfway 1->2 = 175');
  assert(approx(_interpolateEle(prof, -1), 100), 'below range clamps');
  assert(approx(_interpolateEle(prof, 5), 150), 'above range clamps');
  assert(Number.isNaN(_interpolateEle([], 1)), 'empty -> NaN');
}

console.log('── computeSegmentElevations ──');
{
  const prof = [{d:0,ele:100},{d:1,ele:200},{d:2,ele:150},{d:3,ele:150}];
  const rows = [
    { cumDist: 1 },
    { cumDist: 2 },
    { cumDist: 3 },
  ];
  const e = computeSegmentElevations(prof, rows);
  eq(e[0], 100, 'seg1 +100');
  eq(e[1], -50, 'seg2 -50');
  eq(e[2], 0, 'seg3 0');

  // no elevation data -> null
  const flat = [{d:0,ele:NaN},{d:1,ele:NaN}];
  eq(computeSegmentElevations(flat, rows), null, 'all-NaN -> null');
  eq(computeSegmentElevations(null, rows), null, 'null profile -> null');
}

console.log('── buildSegmentsFromGpx ──');
{
  // Fake parsed GPX: 3 points spanning ~straight, 1km apart, flat elevation
  const parsed = {
    points: [
      { lat: 32.0, lon: 34.0, ele: 100, cum: 0 },
      { lat: 32.009, lon: 34.0, ele: 100, cum: 1000 },
      { lat: 32.018, lon: 34.0, ele: 100, cum: 2000 },
    ],
    totalDist: 2.0,
  };
  const segs = buildSegmentsFromGpx(parsed, 300, 1);
  assert(segs.length >= 1, 'produces segments');
  assert(segs.every(s => s.distance > 0 && s.paceSec > 0), 'all valid');
  const dist = round2(segs.reduce((s, x) => s + x.distance, 0));
  assert(approx(dist, 2.0, 0.05), `segments total ${dist} ≈ 2.0`);

  // Uphill: ele rises 50m over 1km -> pace should be slower than base
  const uphill = {
    points: [
      { lat: 32.0, lon: 34.0, ele: 100, cum: 0 },
      { lat: 32.009, lon: 34.0, ele: 150, cum: 1000 },
    ],
    totalDist: 1.0,
  };
  const uSegs = buildSegmentsFromGpx(uphill, 300, 1);
  assert(uSegs[0].paceSec > 300, `uphill pace ${uSegs[0].paceSec} > 300 (base)`);

  // Downhill: ele drops 50m -> pace should be faster than base
  const downhill = {
    points: [
      { lat: 32.0, lon: 34.0, ele: 150, cum: 0 },
      { lat: 32.009, lon: 34.0, ele: 100, cum: 1000 },
    ],
    totalDist: 1.0,
  };
  const dSegs = buildSegmentsFromGpx(downhill, 300, 1);
  assert(dSegs[0].paceSec < 300, `downhill pace ${dSegs[0].paceSec} < 300 (base)`);
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
