// Tests for the climbs and descents the 3D film stops at (src/terrain3d.jsx findClimbs), and its tile maths.
// Run with: node test/terrain3d.test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as babel from '@babel/core';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const assert = (c, m) => { if (c) passed++; else { failed++; console.error('  FAIL: ' + m); } };
const code = babel.transformSync(readFileSync(join(HERE, '..', 'src', 'terrain3d.jsx'), 'utf8'), {
  filename: 'terrain3d.jsx', presets: [['@babel/preset-react', { runtime: 'classic' }]], babelrc: false, configFile: false }).code;
const win = {};
new Function('window', 'document', code)(win, undefined);
const { findClimbs, t3box, t3zoomFor } = win.TERRAIN3D;

const prof = (fn, km = 20, n = 801) => Array.from({ length: n }, (_, i) => { const d = (i / (n - 1)) * km; return { d, ele: fn(d) }; });

console.log('── findClimbs ──');
{ // one hill: 60 m up over 2 km from km 5, back down by km 9
  const P = prof((d) => 100 + (d < 5 ? 0 : d < 7 ? (d - 5) * 30 : d < 9 ? 60 - (d - 7) * 30 : 0));
  const f = findClimbs(P);
  const c = f.filter((x) => x.kind === 'climb'), s = f.filter((x) => x.kind === 'descent');
  assert(c.length === 1, `one climb (${c.length})`);
  assert(s.length === 1, `one descent (${s.length})`);
  assert(c[0] && Math.abs(c[0].d0 - 5) < 0.35 && Math.abs(c[0].d1 - 7) < 0.35, `climb from ~5 to ~7 km (${c[0] && c[0].d0.toFixed(2)}–${c[0] && c[0].d1.toFixed(2)})`);
  assert(c[0] && Math.abs(c[0].gain - 60) < 6, `climb gains ~60 m (${c[0] && c[0].gain.toFixed(1)})`);
  assert(c[0] && Math.abs(c[0].grade - 3) < 0.6, `climb grade ~3 % (${c[0] && c[0].grade.toFixed(2)})`);
  assert(s[0] && s[0].d0 > c[0].d1 - 0.3, 'the descent comes after the climb');
}
{ // flat with GPS noise: nothing
  const P = prof((d) => 20 + Math.sin(d * 37) * 1.5 + Math.sin(d * 11) * 1);
  assert(findClimbs(P).length === 0, 'noise on a flat course is not a hill');
}
{ // a flat city course still names its 20 m bridge
  const P = prof((d) => 5 + 20 * Math.exp(-Math.pow((d - 10) / 0.4, 2)));
  const c = findClimbs(P).filter((x) => x.kind === 'climb');
  assert(c.length === 1 && Math.abs(c[0].gain - 20) < 4, `the bridge is a climb (${c.length}, ${c[0] && c[0].gain.toFixed(1)})`);
}
{ // a hilly course keeps at most `max` of each, the biggest, in course order
  const P = prof((d) => 600 + 80 * Math.sin(d * 1.2) + 30 * Math.sin(d * 3.1), 40, 1601);
  const f = findClimbs(P, { max: 3 });
  assert(f.filter((x) => x.kind === 'climb').length <= 3, 'at most three climbs');
  assert(f.every((x, i) => !i || x.d0 >= f[i - 1].d0), 'in course order');
}
assert(findClimbs([]).length === 0 && findClimbs(null).length === 0, 'no profile, no climbs');

console.log('── tile maths ──');
{
  const tr = [[31.77, 35.21], [31.79, 35.24]];
  const b = t3box(tr);
  assert(b.lat0 < 31.77 && b.lat1 > 31.79 && b.lon0 < 35.21 && b.lon1 > 35.24, 'the box holds the course with a margin');
  const z = t3zoomFor(b, 16, 14);
  assert(z >= 10 && z <= 14, `a sensible zoom for a city course (${z})`);
}
console.log(`\n${'='.repeat(60)}\nterrain3d: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
