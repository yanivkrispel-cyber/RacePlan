// Tests for the 3D view's route geometry (src/route3d.jsx): reading the
// elevation profile at the right distance (buildSamples) and laying out
// courses that run the same road more than once (layoutPasses). Both are pure
// and run on planar meters, so no three.js is needed.
// Run with: node test/route3d.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as babel from '@babel/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

function load(file, win) {
  const code = babel.transformSync(readFileSync(join(SRC, file), 'utf8'), {
    filename: file, presets: [['@babel/preset-react', { runtime: 'classic' }]], babelrc: false, configFile: false,
  }).code;
  new Function('window', 'React', 'ReactDOM', code)(win, { forwardRef: (f) => f, memo: (f) => f }, {});
}
const win = { I18N: { t: (k) => k, dir: 'rtl' } };
load('chart.jsx', win);
load('route3d.jsx', win);
const { buildSamples, layoutPasses } = win.ROUTE3D_LAYOUT;

// ── helpers ──
const N = 241;
const ROAD_M = 86; // the drawn road's width in real meters for a ~3.6 km-wide course
function samplesFrom(fn) { // fn(f in 0..1) -> { x, z, ele }
  return Array.from({ length: N }, (_, i) => fn(i / (N - 1)));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function nearestOther(out, i, minGap) {
  let best = -1, bd = Infinity;
  out.forEach((p, j) => { if (Math.abs(j - i) > minGap) { const d = dist(out[i], p); if (d < bd) { bd = d; best = j; } } });
  return best;
}
function unchanged(inp, out, msg) {
  const maxMove = Math.max(...inp.map((s, i) => dist(s, out[i])));
  const maxEle = Math.max(...inp.map((s, i) => Math.abs(s.ele - out[i].ele)));
  assert(maxMove < 1e-6 && maxEle < 1e-6, `${msg} — moved ${maxMove.toFixed(2)} m, height changed ${maxEle.toFixed(2)} m`);
}
function maxStep(inp, out, skip = []) { // largest change in displacement between neighbours
  let m = 0;
  for (let i = 1; i < inp.length; i++) {
    if (skip.some((k) => Math.abs(i - k) <= 2)) continue;
    const a = { x: out[i].x - inp[i].x, z: out[i].z - inp[i].z }, b = { x: out[i - 1].x - inp[i - 1].x, z: out[i - 1].z - inp[i - 1].z };
    m = Math.max(m, dist(a, b));
  }
  return m;
}
const hill = (s) => 40 + 30 * Math.exp(-(((s - 1500) / 500) ** 2)) + 5 * Math.sin(s / 700);

console.log('\n── layoutPasses: out-and-back on the same road ──');
{
  // 7.5 km north and back, the return 4 m to the east and recorded 4 m lower
  const L = 7500;
  const inp = samplesFrom((f) => {
    const back = f > 0.5, s = back ? (1 - f) * 2 * L : f * 2 * L;
    return { x: back ? 4 : 0, z: -s, ele: hill(s) - (back ? 4 : 0) };
  });
  const out = layoutPasses(inp, ROAD_M);
  let maxEleGap = 0, minSep = Infinity, rightSide = 0, checked = 0;
  for (let i = 15; i < 105; i++) { // the core of the outbound leg, away from both ends
    const j = N - 1 - i;
    maxEleGap = Math.max(maxEleGap, Math.abs(out[i].ele - out[j].ele));
    minSep = Math.min(minSep, dist(out[i], out[j]));
    // heading north (-z) the runner's right is +x; heading south it's -x
    if (out[i].x > out[j].x) rightSide++;
    checked++;
  }
  assert(maxEleGap < 0.3, `both legs share one height (max gap ${maxEleGap.toFixed(2)} m)`);
  assert(minSep > 0.5 * ROAD_M, `the legs sit in separate lanes (min separation ${minSep.toFixed(1)} m)`);
  assert(rightSide === checked, `each leg keeps to its runner's right (${rightSide}/${checked})`);
  assert(out[60].lane > 0.95 && out[N - 61].lane > 0.95, 'the road narrows into lanes along the shared stretch');
  const tipOff = Math.abs(out[120].x - inp[120].x);
  assert(tipOff < 0.15 * ROAD_M, `the lanes meet at the turnaround (tip moved ${tipOff.toFixed(1)} m)`);
  // (the U-turn itself is the one place the lanes swing round sharply)
  const step = maxStep(inp, out, [120]);
  assert(step < 0.12 * ROAD_M, `lanes run smoothly, without kinks (max step ${step.toFixed(1)} m)`);
  const meanShift = out.slice(15, 105).reduce((a, p, k) => a + Math.abs(p.ele - inp[k + 15].ele), 0) / 90;
  assert(Math.abs(meanShift - 2) < 0.3, `the shared height is the average of the two passes (moved ${meanShift.toFixed(2)} m)`);
}

console.log('\n── layoutPasses: courses that never repeat a road ──');
{
  const r = 15000 / (2 * Math.PI);
  const loop = samplesFrom((f) => ({ x: r * Math.cos(f * 2 * Math.PI * 0.97), z: r * Math.sin(f * 2 * Math.PI * 0.97), ele: hill(f * 15000) }));
  unchanged(loop, layoutPasses(loop, ROAD_M), 'an open loop is left exactly as it was');
  const p2p = samplesFrom((f) => ({ x: 300 * Math.sin(f * 9), z: -f * 15000, ele: hill(f * 15000) }));
  unchanged(p2p, layoutPasses(p2p, ROAD_M), 'a point-to-point course is left exactly as it was');
}

console.log('\n── layoutPasses: two laps in the same direction ──');
{
  const r = 7500 / (2 * Math.PI);
  const inp = samplesFrom((f) => {
    const a = f * 4 * Math.PI, lap2 = f > 0.5;
    return { x: (r + (lap2 ? 3 : 0)) * Math.cos(a), z: (r + (lap2 ? 3 : 0)) * Math.sin(a), ele: hill((f * 15000) % 7500) - (lap2 ? 3 : 0) };
  });
  const out = layoutPasses(inp, ROAD_M);
  const i = 60, j = 180; // the same place on lap 1 and lap 2
  assert(Math.abs(out[i].ele - out[j].ele) < 0.3, `laps share one height (gap ${Math.abs(out[i].ele - out[j].ele).toFixed(2)} m)`);
  assert(dist(out[i], inp[i]) < 1 && dist(out[j], inp[j]) < 1, 'laps stay on one road — no lanes for the same direction');
  assert(out[i].lane < 0.05 && out[j].lane < 0.05, 'laps keep the full road width');
  assert(out[i].lift < 0.05 && out[j].lift > 0.95, 'the later lap sits a hair above the earlier one');
}

console.log('\n── layoutPasses: twice out-and-back on the same road ──');
{
  const Q = 3750;
  const inp = samplesFrom((f) => {
    const s = f * 4 * Q, leg = Math.min(3, Math.floor(s / Q)), r = s - leg * Q, north = leg % 2 === 0;
    return { x: north ? 0 : 4, z: -(north ? r : Q - r), ele: hill(north ? r : Q - r) + leg };
  });
  const out = layoutPasses(inp, ROAD_M);
  // the same spot (1.5 km out) on all four passes
  const at = [0, 1, 2, 3].map((leg) => Math.round(((leg * Q + (leg % 2 ? Q - 1500 : 1500)) / (4 * Q)) * (N - 1)));
  const eles = at.map((k) => out[k].ele);
  assert(Math.max(...eles) - Math.min(...eles) < 0.5, `all four passes share one height (spread ${(Math.max(...eles) - Math.min(...eles)).toFixed(2)} m)`);
  assert(Math.abs(out[at[0]].x - out[at[2]].x) < 2, 'both northbound passes share a lane');
  assert(Math.abs(out[at[1]].x - out[at[3]].x) < 2, 'both southbound passes share a lane');
  assert(out[at[0]].x - out[at[1]].x > 0.5 * ROAD_M, 'northbound and southbound are separate lanes, each on its right');
}

console.log('\n── layoutPasses: separate carriageways ──');
{
  for (const eastFirst of [false, true]) {
    // a boulevard with a median: the two directions 60 m apart, at different heights
    const L = 7500;
    const inp = samplesFrom((f) => {
      const back = f > 0.5, s = back ? (1 - f) * 2 * L : f * 2 * L;
      const east = back !== eastFirst;
      return { x: east ? 30 : -30, z: -s, ele: hill(s) + (back ? 6 : 0) };
    });
    const out = layoutPasses(inp, ROAD_M);
    const i = 60, j = N - 1 - i, before = inp[j].x - inp[i].x, after = out[j].x - out[i].x;
    const label = eastFirst ? 'outbound on the left' : 'outbound on the right';
    assert(Math.sign(after) === Math.sign(before), `${label}: the carriageways never swap sides`);
    assert(Math.abs(after) >= Math.abs(before), `${label}: they only move further apart (${Math.abs(before)} → ${Math.abs(after).toFixed(0)} m)`);
    assert(Math.abs(after) > 0.5 * ROAD_M, `${label}: far enough apart to read as two lanes`);
    assert(Math.abs(out[i].ele - inp[i].ele) < 1e-6, `${label}: 60 m apart is two roads — heights are left alone`);
  }
}

console.log('\n── layoutPasses: a crossing and a lollipop ──');
{
  // a figure-eight: the route crosses itself at right angles in the middle
  const inp = samplesFrom((f) => {
    const a = f * 2 * Math.PI;
    return { x: 2500 * Math.sin(a), z: 1500 * Math.sin(2 * a), ele: hill(f * 15000) };
  });
  const out = layoutPasses(inp, ROAD_M);
  const mid = Math.round((N - 1) / 2);
  assert(dist(out[mid], inp[mid]) < 1e-6 && Math.abs(out[mid].ele - inp[mid].ele) < 1e-6, 'a right-angle crossing is left alone');
}
{
  // 4 km stem out and back, with a loop at the far end
  const stem = 4000, loopLen = 7000, total = 2 * stem + loopLen, r = loopLen / (2 * Math.PI);
  const inp = samplesFrom((f) => {
    const s = f * total;
    if (s <= stem) return { x: 0, z: -s, ele: hill(s) };
    if (s >= stem + loopLen) return { x: 3, z: -(total - s), ele: hill(total - s) - 3 };
    const a = ((s - stem) / loopLen) * 2 * Math.PI;
    return { x: r * Math.sin(a), z: -(stem + r - r * Math.cos(a)), ele: 60 };
  });
  const out = layoutPasses(inp, ROAD_M);
  const i = 30, j = nearestOther(inp, i, 20);
  assert(out[i].lane > 0.95 && dist(out[i], out[j]) > 0.5 * ROAD_M, 'the stem splits into two lanes');
  const far = Math.round((N - 1) / 2);
  assert(dist(out[far], inp[far]) < 1e-6, 'the loop at the far end is left alone');
}

console.log('\n── buildSamples: heights read at the profile\'s own distance ──');
{
  // A recorded out-and-back: dense 3 m points with GPS jitter (so the full
  // track is longer than its thinned copy), a profile measured on the full
  // track, and a track thinned the way the planner stores it.
  const R = 6371000, rad = Math.PI / 180, lat0 = 32.13, lon0 = 34.84;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const full = [];
  const L = 7500, step = 3;
  for (let s = 0; s <= 2 * L; s += step) {
    const along = s <= L ? s : 2 * L - s;
    full.push({ lat: lat0 + (along + rnd() * 1.6) / R / rad, lon: lon0 + (rnd() * 1.6) / (R * Math.cos(lat0 * rad)) / rad, ele: hill(along) });
  }
  const hav = (a, b) => {
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };
  let cum = 0;
  const profileFull = full.map((p, i) => { if (i) cum += hav(full[i - 1], p); return { d: cum / 1000, ele: p.ele }; });
  const thin = (arr, max) => { const st = Math.ceil(arr.length / max), o = []; for (let i = 0; i < arr.length; i += st) o.push(arr[i]); if (o[o.length - 1] !== arr[arr.length - 1]) o.push(arr[arr.length - 1]); return o; };
  const profile = thin(profileFull, 320);
  const track = thin(full.map((p) => [p.lat, p.lon]), 500);
  const { samples } = buildSamples(track, profile, 240);
  let worst = 0;
  for (let i = 0; i <= 120; i++) worst = Math.max(worst, Math.abs(samples[i].ele - samples[240 - i].ele));
  assert(worst < 1.5, `the same place reads the same height out and back (worst ${worst.toFixed(2)} m)`);
  const { samples: none } = buildSamples(track, null, 60);
  assert(none.every((s) => s.ele === 0), 'a route without elevation stays flat');
  const { samples: partial } = buildSamples(track, [{ d: 0, ele: NaN }, { d: 1, ele: 50 }], 60);
  assert(partial.every((s) => isFinite(s.ele)), 'a profile with missing heights never yields NaN');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
