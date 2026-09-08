// Function tests for the pure helpers in src/routes.jsx (flat-array course
// decode + community-submission record builder). The React/JSX parts of the
// file are sliced off; only the top pure-helper region is evaluated.
// Run with: node test/routes.test.mjs

import { readFileSync } from 'fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// ── slice the pure-helper region (before the first JSX function) ──────────
const src = readFileSync(new URL('../src/routes.jsx', import.meta.url), 'utf8');
const start = src.indexOf('// keep ~N evenly-spaced samples');
const end = src.indexOf('function StatusBadge');
if (start < 0 || end < 0) {
  console.error('routes.jsx: could not locate the pure-helper region');
  process.exit(1);
}
const body = src.slice(start, end);

const fn = new Function(`${body}
  return { rl_downsample, decodeFlatCourse, courseFromRace, courseFromSubmission,
           buildSubmissionRecord, rl_slug, makeRaceId, round3, round5, fmtSubDate };`);
const H = fn();

// ═════════════════════════════════════════════════════════════════════════
console.log('\n── decodeFlatCourse ──');
{
  const rec = {
    profileFlat: [0, 10, 1, 20, 2, 15],
    trackFlat: [32.1, 34.8, 32.2, 34.9],
    distanceKm: 2, gain: 10, loss: 5, startLat: 32.1, startLon: 34.8,
  };
  const c = H.decodeFlatCourse(rec, { name: 'X', source: 'link' });
  assert(c.name === 'X', 'name from opts');
  assert(c.source === 'link', 'source from opts');
  assert(c.profile.length === 3, 'profile decoded to 3 points');
  assert(approx(c.profile[1].d, 1) && approx(c.profile[1].ele, 20), 'profile pair [1]');
  assert(c.track.length === 2 && approx(c.track[0][0], 32.1), 'track decoded');
  assert(c.dist === 2 && c.gain === 10 && c.loss === 5, 'scalars copied');
  assert(approx(c.lat, 32.1) && approx(c.lon, 34.8), 'start coords');
}
{
  const c = H.decodeFlatCourse({ profileFlat: [], trackFlat: [] }, {});
  assert(c.profile === null && c.track === null, 'empty flats -> null');
  assert(c.dist === 0, 'no distanceKm, no profile -> 0');
  assert(c.lat === null && c.lon === null, 'no coords -> null');
}
{
  // start coords fall back to the first track point when not given
  const c = H.decodeFlatCourse({ trackFlat: [1.5, 2.5, 3, 4] }, {});
  assert(approx(c.lat, 1.5) && approx(c.lon, 2.5), 'lat/lon from first track point');
  // dist falls back to the last profile d
  const c2 = H.decodeFlatCourse({ profileFlat: [0, 0, 7.5, 30] }, {});
  assert(approx(c2.dist, 7.5), 'dist from last profile point');
}

console.log('── courseFromRace / courseFromSubmission ──');
{
  const rc = { nameHe: 'מרתון חיפה', name: 'Haifa', profileFlat: [0, 0, 5, 120], trackFlat: [32.8, 35, 32.81, 35.01] };
  const c = H.courseFromRace(rc);
  assert(c.name === 'מרתון חיפה', 'race uses nameHe');
  assert(c.source === 'library', 'race source code');

  const sub = {
    courseName: 'לופ הכרמל', raceName: 'מרתון חיפה',
    profileFlat: [0, 0, 5, 120, 10, 0], trackFlat: [32.8, 35, 32.81, 35.01],
    distanceKm: 10, gain: 120, loss: 120, startLat: 32.8, startLon: 35,
  };
  const s = H.courseFromSubmission(sub);
  assert(s.name === 'לופ הכרמל', 'submission uses courseName');
  assert(s.source === 'community', 'submission source code');
  assert(s.profile.length === 3 && s.track.length === 2, 'submission decoded');

  const s2 = H.courseFromSubmission({ raceName: 'מרוץ X', trackFlat: [] });
  assert(s2.name === 'מרוץ X', 'submission falls back to raceName');
}

console.log('── buildSubmissionRecord ──');
{
  const pending = {
    course: {
      name: 'Route A', dist: 42.123456, gain: 301.7, loss: 288.2,
      lat: 32.123456789, lon: 34.987654321, source: 'file.gpx',
    },
    profileFlat: [0, 0, 1, 5], trackFlat: [32.1, 34.9], sourceUrl: null, gpxText: '<gpx/>',
  };
  const race = { id: 'haifa-marathon', nameHe: 'מרתון חיפה', name: 'Haifa Marathon' };
  const user = { uid: 'u1', email: 'a@b.com', name: 'Runner' };
  const r = H.buildSubmissionRecord({ ...pending, gpxPath: 'submissions/x.gpx' }, race, user);
  assert(r.raceId === 'haifa-marathon', 'raceId');
  assert(r.raceName === 'מרתון חיפה', 'raceName prefers nameHe');
  assert(r.courseName === 'Route A', 'courseName from course.name');
  assert(r.status === 'pending', 'status pending');
  assert(r.submitterUid === 'u1' && r.submitterEmail === 'a@b.com' && r.submitterName === 'Runner', 'submitter fields');
  assert(r.distanceKm === H.round3(42.123456) && r.distanceKm === 42.123, 'distance rounded to 3 dp');
  assert(r.startLat === H.round5(32.123456789) && r.startLon === H.round5(34.987654321), 'coords rounded to 5 dp');
  assert(r.gain === 302 && r.loss === 288, 'gain/loss rounded to int');
  assert(r.gpxPath === 'submissions/x.gpx', 'gpxPath passthrough');
  assert(r.source === 'file.gpx', 'source from course.source');
  assert(Array.isArray(r.trackFlat) && r.trackFlat.length === 2, 'trackFlat copied');
  assert(Array.isArray(r.profileFlat) && r.profileFlat.length === 4, 'profileFlat copied');
}
{
  // no user, no coords, no gpx, link source
  const r = H.buildSubmissionRecord(
    { course: { name: 'R', dist: 5 }, trackFlat: [], sourceUrl: 'https://x/y.gpx' },
    { id: 'x' }, null);
  assert(r.submitterUid === '' && r.submitterEmail === '', 'no user -> empty strings');
  assert(r.startLat === null && r.startLon === null, 'no coords -> null');
  assert(r.raceName === '', 'no race name -> empty string');
  assert(r.profileFlat === null, 'no profileFlat -> null');
  assert(r.source === 'link', 'sourceUrl present -> "link"');
  assert(r.gpxPath === null, 'no gpxPath -> null');
}
{
  const r = H.buildSubmissionRecord({ course: { name: 'R', dist: 5 }, trackFlat: [] }, { id: 'x' }, null);
  assert(r.source === 'file', 'no source, no url -> "file"');
}

console.log('── fmtSubDate ──');
{
  assert(H.fmtSubDate(null) === '', 'null -> empty');
  assert(H.fmtSubDate({}) === '', 'no millis -> empty');
  const d = new Date(2026, 8, 7);
  assert(H.fmtSubDate({ seconds: Math.floor(d.getTime() / 1000) }).length >= 4, '{seconds} -> a date string');
  assert(H.fmtSubDate({ toMillis: () => d.getTime() }).length >= 4, 'Timestamp.toMillis -> a date string');
}

console.log('── makeRaceId / rl_slug (regression) ──');
{
  assert(H.rl_slug('Eilat Marathon') === 'eilat-marathon', 'slug basic');
  assert(H.rl_slug('  Tel-Aviv  ') === 'tel-aviv', 'slug trims + collapses');
  const id = H.makeRaceId('Tel Aviv Marathon', 'Tel Aviv', 'marathon', new Set());
  assert(id === 'tel-aviv-marathon-marathon', 'id has dist tag');
  const id2 = H.makeRaceId('Tel Aviv Marathon', 'Tel Aviv', 'marathon', new Set(['tel-aviv-marathon-marathon']));
  assert(id2 === 'tel-aviv-marathon-marathon-2', 'id de-duplicates');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`routes.jsx helpers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
