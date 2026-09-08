// Tests for the measurement-system layer (src/units.jsx). The whole module is
// evaluated against a fake `window` (fake localStorage + a stub I18N + the two
// engine formatters); then window.UNITS is exercised in both systems.
// Run with: node test/units.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }
function near(a, b, msg, eps = 0.01) { assert(approx(a, b, eps), `${msg} — expected ~${b}, got ${a}`); }
function eq(a, b, msg) { assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// engine formatters (m:ss) — copied minimal versions matching engine.jsx
const pad2 = (n) => String(n).padStart(2, '0');
const formatPace = (sec) => {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
};
const parsePace = (str) => {
  const m = String(str).trim().match(/^(\d+):(\d{1,2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
};

const store = {};
const fakeWin = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  I18N: {
    locale: 'en',
    t: (k) => ({
      'units.km': 'km', 'units.mi': 'mi', 'units.m': 'm', 'units.ft': 'ft',
      'units.perKm': '/ km', 'units.perMi': '/ mi', 'units.kmh': 'km/h', 'units.mph': 'mph',
    }[k] || k),
    fmtNumber: (n) => String(n),
  },
  formatPace, parsePace,
};

const src = readFileSync(join(SRC, 'units.jsx'), 'utf8');
new Function('window', src)(fakeWin);
const U = fakeWin.UNITS;
assert(!!U, 'window.UNITS defined');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── resolveUnitSystem ──');
eq(U._resolveUnitSystem({ query: 'imperial' }), 'imperial', 'query wins');
eq(U._resolveUnitSystem({ stored: 'metric', locale: 'en' }), 'metric', 'stored beats locale default');
eq(U._resolveUnitSystem({ locale: 'en' }), 'imperial', 'en → imperial default');
eq(U._resolveUnitSystem({ locale: 'fr' }), 'metric', 'fr → metric default');
eq(U._resolveUnitSystem({ locale: 'he' }), 'metric', 'he → metric default');

console.log('── metric ──');
U.setSystem('metric');
eq(U.system, 'metric', 'system is metric');
near(U.dispDist(10), 10, 'dispDist passthrough');
eq(U.distUnit(), 'km', 'distUnit km');
near(U.parseDist('10'), 10, 'parseDist passthrough');
eq(U.fmtPace(300), '5:00', 'fmtPace passthrough');
eq(U.paceUnit(), '/ km', 'paceUnit /km');
near(U.dispElev(100), 100, 'dispElev passthrough');
eq(U.fmtElev(120), '120 m', 'fmtElev metric');
near(U.paceFromDisplaySec(U.dispPaceSec(312)), 312, 'pace round-trip metric');

console.log('── imperial ──');
U.setSystem('imperial');
eq(U.system, 'imperial', 'system is imperial');
near(U.dispDist(1.609344), 1, 'dispDist km→mi');
eq(U.distUnit(), 'mi', 'distUnit mi');
near(U.parseDist('1'), 1.609344, 'parseDist mi→km');
eq(U.dispDistNum(42.195, 2), '26.22', 'marathon in miles (2dp)');
// 5:00 /km  →  ~8:03 /mi
eq(U.fmtPace(300), '8:03', 'fmtPace km→mi');
eq(U.paceUnit(), '/ mi', 'paceUnit /mi');
near(U.dispElev(100), 328.084, 'dispElev m→ft', 0.01);
eq(U.elevInt(100), 328, 'elevInt m→ft');
eq(U.fmtElev(100), '328 ft', 'fmtElev imperial');
eq(U.elevUnit(), 'ft', 'elevUnit ft');
near(U.paceFromDisplaySec(U.dispPaceSec(312)), 312, 'pace round-trip imperial');
near(U.parseDist(U.dispDistNum(21.0975, 6)), 21.0975, 'dist round-trip imperial', 0.01);
// typed "8:03" /mi should read back to ~300 s/km
{
  const back = U.parsePaceInput('8:03');
  assert(Math.abs(back - 300) < 2, `parsePaceInput 8:03 /mi → ~300 s/km (got ${Math.round(back)})`);
}

console.log('── persistence ──');
assert(store['rp-units'] === 'imperial', 'setSystem persisted to localStorage');
U.setSystem('metric');
eq(store['rp-units'], 'metric', 'switch persisted');

// ── Summary ────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`units: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
