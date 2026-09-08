// Function tests for the pure logic in src/myplans.jsx (serializePlan +
// MyPlansDB list operations). The React/JSX panel is sliced off; MyPlansSync
// resolves to its disabled stub (no window.RP_FIREBASE), localStorage is faked.
// Run with: node test/myplans.test.mjs

import { readFileSync } from 'fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

const src = readFileSync(new URL('../src/myplans.jsx', import.meta.url), 'utf8');
const end = src.indexOf('function MyPlansPanel');
if (end < 0) { console.error('myplans.jsx: could not locate MyPlansPanel'); process.exit(1); }
const body = src.slice(0, end);

const fakeLS = {
  store: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
};
const fakeWin = {
  round2: (n) => Math.round(n * 100) / 100,
  I18N: { locale: 'he', t: (k) => ({ 'myplans.untitled': 'תכנון' }[k] || k) },
};

const fn = new Function('window', 'localStorage', `${body}
  return { serializePlan, MyPlansDB, defaultPlanName, formatSavedAt };`);
const H = fn(fakeWin, fakeLS);

// ═════════════════════════════════════════════════════════════════════════
console.log('\n── serializePlan ──');
{
  const cur = {
    raceName: 'מרתון תל אביב', raceDate: '2026-02-27', raceTime: '06:30', trainer: 'דנה',
    segments: [{ distance: 5.004, paceSec: 300 }, { distance: 2.2, paceSec: 315 }],
    preset: 42.2,
    course: null,
  };
  const s = H.serializePlan(cur);
  assert(s.raceName === 'מרתון תל אביב' && s.raceDate === '2026-02-27' && s.raceTime === '06:30', 'meta copied');
  assert(s.trainer === 'דנה', 'trainer copied');
  assert(Array.isArray(s.segments) && s.segments.length === 2, 'segments length');
  assert(Array.isArray(s.segments[0]) && approx(s.segments[0][0], 5) && s.segments[0][1] === 300, 'segment -> [km,pace], km rounded 2dp');
  assert(s.preset === 42.2, 'preset copied');
  assert(s.course === null, 'no course -> null');
}
{
  const withGpx = {
    segments: [],
    course: {
      name: 'Carmel Loop', dist: 10.2, gain: 210, loss: 205, source: 'carmel.gpx',
      profile: [{ d: 0, ele: 0 }, { d: 5, ele: 120 }],
      track: [[32.8, 35.0], [32.81, 35.01]],
    },
  };
  const s = H.serializePlan(withGpx);
  assert(s.course && s.course.name === 'Carmel Loop' && s.course.dist === 10.2, 'course scalars');
  assert(s.course.profile.length === 2 && s.course.track.length === 2, 'course profile/track kept (nested arrays ok in a JSON blob)');
  assert(s.segments.length === 0, 'empty segments -> []');
}
{
  const s = H.serializePlan({});
  assert(s.raceName === '' && s.trainer === '' && s.segments.length === 0 && s.course === null, 'empty input -> safe defaults');
}

console.log('── defaultPlanName ──');
{
  const iso = new Date(2026, 1, 27, 6, 30).toISOString();
  assert(H.defaultPlanName({ raceName: 'מרתון' }, iso).startsWith('מרתון — '), 'uses raceName');
  assert(H.defaultPlanName({}, iso).startsWith('תכנון — '), 'falls back to "תכנון"');
}

console.log('── MyPlansDB: save / getAll / order ──');
{
  fakeLS.store = {};
  assert(H.MyPlansDB.getAll().length === 0, 'starts empty');

  const a = H.MyPlansDB.save({ raceName: 'A', segments: [{ distance: 1, paceSec: 300 }], preset: 10, course: null }, 'תכנון A');
  assert(a.id && a.name === 'תכנון A' && a.savedAt, 'save returns id/name/savedAt');
  assert(a.segments[0][0] === 1 && a.segments[0][1] === 300, 'saved plan carries serialised segments');

  const b = H.MyPlansDB.save({ raceName: 'B', segments: [], preset: null, course: null }, '');
  assert(b.name.startsWith('B — '), 'blank name -> default from raceName');

  const all = H.MyPlansDB.getAll();
  assert(all.length === 2, 'two plans stored');
  assert(all[0].id === b.id, 'newest first (unshift)');

  // persisted to localStorage as { plans: [...] }
  const raw = JSON.parse(fakeLS.store['rp-myplans-v1']);
  assert(Array.isArray(raw.plans) && raw.plans.length === 2, 'localStorage mirror shape');
}

console.log('── MyPlansDB: rename / remove ──');
{
  fakeLS.store = {};
  const p1 = H.MyPlansDB.save({ raceName: 'One', segments: [], preset: null, course: null }, 'one');
  const p2 = H.MyPlansDB.save({ raceName: 'Two', segments: [], preset: null, course: null }, 'two');

  H.MyPlansDB.rename(p1.id, 'ONE renamed');
  assert(H.MyPlansDB.getAll().find((p) => p.id === p1.id).name === 'ONE renamed', 'rename applied');

  H.MyPlansDB.rename(p2.id, '   ');
  assert(H.MyPlansDB.getAll().find((p) => p.id === p2.id).name === 'two', 'blank rename keeps old name');

  H.MyPlansDB.remove(p1.id);
  const left = H.MyPlansDB.getAll();
  assert(left.length === 1 && left[0].id === p2.id, 'remove drops the right plan');

  H.MyPlansDB.remove('nope');
  assert(H.MyPlansDB.getAll().length === 1, 'removing an unknown id is a no-op');
}

console.log('── MyPlansDB: corrupt storage ──');
{
  fakeLS.store = { 'rp-myplans-v1': '{ not json' };
  assert(H.MyPlansDB.getAll().length === 0, 'unparseable store -> empty list');
  fakeLS.store = { 'rp-myplans-v1': JSON.stringify({ plans: 'x' }) };
  assert(H.MyPlansDB.getAll().length === 0, 'plans not an array -> empty list');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`myplans.jsx helpers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
