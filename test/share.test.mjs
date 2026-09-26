// Function tests for the share-link payload in src/planner-b.jsx: the plan and
// its route must survive encode → URL → decode, and the link must stay short.
// Run with: node test/share.test.mjs

import { readFileSync } from 'fs';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const src = readFileSync(new URL('../src/planner-b.jsx', import.meta.url), 'utf8');
const start = src.indexOf('// keep ~N evenly-spaced samples');
const end = src.indexOf('// contentEditable text that commits');
if (start < 0 || end < 0) {
  console.error('planner-b.jsx: could not locate the share-helper region');
  process.exit(1);
}
const fn = new Function(`const round2 = (n) => Math.round(n * 100) / 100;
  ${src.slice(start, end)}
  return { encodePlan, decodePlan, encodeCourse, decodeCourse, sharePayload, parseSharePayload, sharePathId };`);
const H = fn();

// A marathon-sized course shaped like what the GPX import produces.
const profile = [];
for (let i = 0; i < 320; i++) {
  const d = (42.195 * i) / 319;
  profile.push({ d, ele: 20 + 30 * Math.sin(d / 3) + (i % 7) * 0.4 });
}
const track = [];
for (let i = 0; i < 500; i++) {
  const a = (i / 499) * Math.PI * 2;
  track.push([32.08 + 0.05 * Math.sin(a) + i * 1e-5, 34.78 + 0.07 * Math.cos(a)]);
}
const course = {
  name: 'מרתון תל אביב', dist: 42.195, gain: 180.4, loss: 179.6, source: 'library',
  profile, track, lat: track[0][0], lon: track[0][1],
};
const segments = Array.from({ length: 9 }, (_, i) => ({ distance: i < 8 ? 5 : 2.195, paceSec: 290 + i }));

console.log('\n── share link with a route ──');
{
  const enc = H.encodePlan('מרתון ת"א', 'Kris', null, segments, course);
  console.log(`  encoded length: ${enc.length} chars`);
  assert(/^[A-Za-z0-9_-]+$/.test(enc), 'payload is base64url (no + / =)');
  assert(enc.length < 8000, 'link payload stays under 8 KB');

  const data = H.decodePlan(enc);
  assert(data && data.r === 'מרתון ת"א', 'race name round-trips (Hebrew)');
  assert(data.s.length === 9 && Math.abs(data.s[8][0] - 2.195) < 0.01 && data.s[0][1] === 290, 'segments round-trip');

  const c = H.decodeCourse(data.c);
  assert(c && c.name === course.name, 'course name round-trips');
  assert(c.dist === 42.195 && c.gain === 180 && c.loss === 180, 'dist/gain/loss round-trip');
  assert(c.profile.length > 100 && c.profile.length <= 201, 'profile thinned but kept');
  assert(c.track.length > 100 && c.track.length <= 301, 'track thinned but kept');
  assert(Math.abs(c.profile[c.profile.length - 1].d - 42.195) < 0.01, 'profile ends at the finish');
  const worstEle = Math.max(...c.profile.map((pt) => {
    const src = profile.reduce((b, q) => (Math.abs(q.d - pt.d) < Math.abs(b.d - pt.d) ? q : b));
    return Math.abs(src.ele - pt.ele);
  }));
  assert(worstEle <= 0.51, 'elevation within 0.5 m');
  const worstLL = Math.max(...c.track.map((pt) => Math.min(...track.map((q) =>
    Math.max(Math.abs(q[0] - pt[0]), Math.abs(q[1] - pt[1]))))));
  assert(worstLL <= 0.00006, 'track within ~1e-4°');
  assert(Math.abs(c.lat - course.lat) < 1e-5 && Math.abs(c.lon - course.lon) < 1e-5, 'start point kept');
}

console.log('\n── share link without a route ──');
{
  const enc = H.encodePlan('10K', '', 10, segments.slice(0, 2), null);
  const data = H.decodePlan(enc);
  assert(data && !data.c, 'no course → no c field');
  assert(H.decodeCourse(data.c) === null, 'decodeCourse(undefined) is null');
}

console.log('\n── old links still open ──');
{
  // v1 links were plain base64 (with + / and = padding), no course.
  const legacy = { v: 1, r: 'ישן', t: '', p: 10, s: [[5, 300], [5, 295]] };
  const bytes = new TextEncoder().encode(JSON.stringify(legacy));
  let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const data = H.decodePlan(btoa(bin));
  assert(data && data.r === 'ישן' && data.s.length === 2, 'legacy base64 link decodes');
  assert(H.decodePlan('not-a-plan') === null, 'garbage → null');
}

console.log('\n── short links (/p/{id}) ──');
{
  const json = JSON.stringify(H.sharePayload('Berlin', 'Kris', null, segments, course));
  const data = H.parseSharePayload(json);
  assert(data && data.r === 'Berlin' && data.s.length === 9, 'stored payload parses');
  assert(H.decodeCourse(data.c).track.length > 100, 'stored payload carries the route');
  assert(json.length < 60000, 'stored payload fits the rules size cap');
  assert(H.parseSharePayload('{"v":2,"s":[[1,300]]}') === null, 'unknown version rejected');
  assert(H.parseSharePayload('nope') === null, 'bad JSON rejected');
  assert(H.sharePathId('/p/Ab3xK9qZmN') === 'Ab3xK9qZmN', '/p/{id} recognised');
  assert(H.sharePathId('/p/Ab3xK9qZmN/') === 'Ab3xK9qZmN', 'trailing slash ok');
  assert(H.sharePathId('/') === null && H.sharePathId('/privacy') === null, 'other paths ignored');
  assert(H.sharePathId('/p/ab') === null && H.sharePathId('/p/a.b-cdef') === null, 'malformed ids ignored');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
