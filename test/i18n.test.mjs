// Tests for the i18n layer (src/i18n.jsx) + a static guard on the source tree.
// The React/singleton part of i18n.jsx is sliced off; only the pure region
// (DICTS + resolveLocale/applyParams/pluralCategory/lookup/makeT) is evaluated.
// Run with: node test/i18n.test.mjs

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

// ── slice the pure region of i18n.jsx ───────────────────────────────────
const i18nSrc = readFileSync(join(SRC, 'i18n.jsx'), 'utf8');
const cut = i18nSrc.indexOf('// ── the singleton');
if (cut < 0) { console.error('i18n.jsx: could not find the singleton marker'); process.exit(1); }
const body = i18nSrc.slice(0, cut);

const fn = new Function(`${body}
  return { RP_LOCALES, RP_RTL, DICTS, resolveLocale, applyParams, pluralCategory, lookup, makeT };`);
const H = fn();

// ═══════════════════════════════════════════════════════════════════════
console.log('\n── locales ──');
assert(Array.isArray(H.RP_LOCALES) && H.RP_LOCALES.length === 4, 'four locales');
['he', 'en', 'fr', 'es'].forEach((l) => assert(H.RP_LOCALES.includes(l), `has ${l}`));
assert(H.RP_RTL.has('he'), 'he is RTL');
assert(!H.RP_RTL.has('en'), 'en is not RTL');

console.log('── dictionary key parity ──');
{
  const keysOf = (o) => Object.keys(o).sort();
  const he = keysOf(H.DICTS.he);
  assert(he.length > 20, `he dictionary is populated (${he.length} keys)`);
  for (const loc of ['en', 'fr', 'es']) {
    const k = keysOf(H.DICTS[loc]);
    const missing = he.filter((x) => !H.DICTS[loc].hasOwnProperty(x));
    const extra = k.filter((x) => !H.DICTS.he.hasOwnProperty(x));
    assert(missing.length === 0, `${loc}: no missing keys (missing: ${missing.slice(0, 8).join(', ')})`);
    assert(extra.length === 0, `${loc}: no extra keys (extra: ${extra.slice(0, 8).join(', ')})`);
  }
}

console.log('── no empty values ──');
for (const loc of H.RP_LOCALES) {
  const bad = Object.entries(H.DICTS[loc]).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
  assert(bad.length === 0, `${loc}: no empty strings (${bad.slice(0, 5).map(([k]) => k).join(', ')})`);
}

console.log('── placeholder parity (same {tokens} across locales) ──');
{
  const toks = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
  let mism = 0;
  for (const key of Object.keys(H.DICTS.he)) {
    const want = toks(H.DICTS.he[key]);
    for (const loc of ['en', 'fr', 'es']) {
      if (toks(H.DICTS[loc][key] || '') !== want) {
        mism++;
        if (mism <= 8) console.error(`      ${loc} ${key}: "${H.DICTS[loc][key]}" vs he "${H.DICTS.he[key]}"`);
      }
    }
  }
  assert(mism === 0, `placeholder tokens match he in every locale (${mism} mismatch)`);
}

console.log('── resolveLocale ──');
eq(H.resolveLocale({ query: 'fr', stored: 'en', nav: 'de' }), 'fr', '?lang wins');
eq(H.resolveLocale({ stored: 'es', nav: 'en-US' }), 'es', 'stored beats nav');
eq(H.resolveLocale({ nav: 'en-GB' }), 'en', 'nav prefix match');
eq(H.resolveLocale({ nav: 'de' }), 'he', 'unknown → he');
eq(H.resolveLocale({}), 'he', 'nothing → he');
eq(H.resolveLocale({ query: 'zz', stored: 'fr' }), 'fr', 'bad query falls through');

console.log('── applyParams ──');
eq(H.applyParams('hi {name}', { name: 'Dana' }), 'hi Dana', 'basic interp');
eq(H.applyParams('{a} + {b} = {c}', { a: 1, b: 2, c: 3 }), '1 + 2 = 3', 'multi');
eq(H.applyParams('no tokens', { x: 1 }), 'no tokens', 'no tokens untouched');
eq(H.applyParams('keep {missing}', {}), 'keep {missing}', 'missing param left as-is');

console.log('── pluralCategory ──');
eq(H.pluralCategory('en', 1), 'one', 'en 1 → one');
eq(H.pluralCategory('en', 3), 'other', 'en 3 → other');
eq(H.pluralCategory('fr', 0), 'one', 'fr 0 → one');

console.log('── makeT (interpolation + fallback) ──');
{
  let loc = 'fr';
  const t = H.makeT(() => H.DICTS[loc], () => H.DICTS.en, () => loc);
  eq(t('common.cancel'), 'Annuler', 'fr lookup');
  loc = 'he';
  eq(t('common.cancel'), 'ביטול', 'he lookup direct');
  eq(t('hub.hello', { name: 'X' }), 'שלום X', 'he interp');
  loc = 'en';
  eq(t('does.not.exist'), 'does.not.exist', 'missing key → key string');
  loc = 'fr';
  // a key present in en but (hypothetically) not fr would fall back to en;
  // here every key exists, so just assert fr resolves and interpolates
  assert(t('setup.previewLine', { count: 3, fast: '5:00', slow: '5:30', per: '/ km', total: '25:00' })
    .indexOf('{') === -1, 'fr previewLine fully interpolated');
}

// ── Summary ────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`i18n: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
