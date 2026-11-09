// The anonymous funnel counters: event validation, day keys, the morning message.
// Run with: node test/tracking.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const T = require('../functions/tracking-core.js');

let passed = 0, failed = 0;
const assert = (c, m) => { if (c) passed++; else { failed++; console.error('  FAIL: ' + m); } };
const eq = (a, b, m) => assert(a === b, `${m} (expected ${b}, got ${a})`);

const good = { step: 'land', src: 'instagram', dev: 'ios' };
assert(T.parseEvent(JSON.stringify(good))?.step === 'land', 'a JSON string is accepted');
assert(T.parseEvent(good)?.src === 'instagram', 'a parsed body is accepted');
eq(T.parseEvent({ ...good, step: 'nope' }), null, 'unknown step refused');
eq(T.parseEvent({ ...good, src: 'x' }), null, 'unknown source refused');
eq(T.parseEvent({ ...good, dev: 'x' }), null, 'unknown device refused');
eq(T.parseEvent('not json'), null, 'garbage refused');
eq(T.parseEvent(null), null, 'empty refused');
eq(T.parseEvent(JSON.stringify(good) + ' '.repeat(T.MAX_BODY)), null, 'long body refused');
assert(!('name' in T.parseEvent({ ...good, name: 'a person' })), 'nothing but the three fields survives');

// 2026-11-08 22:30 UTC is already the 9th in Israel
const late = new Date('2026-11-08T22:30:00Z');
eq(T.dayKey(late), '2026-11-09', 'the day is the Israeli day');
eq(T.dayKey(late, 1), '2026-11-08', 'yesterday');
eq(T.docId({ step: 'ping' }, late), '_ping', 'the health check stays out of the days');
eq(T.docId(good, late), '2026-11-09', 'an event goes to its day');

const p = T.statsPatch(good, 'INC');
eq(p.s.land.instagram, 'INC', 'source counter');
eq(p.d.land.ios, 'INC', 'device counter');

const doc = { s: { land: { instagram: 7, direct: 2 }, signup: { instagram: 1 } } };
eq(T.total(doc, 'land'), 9, 'total adds the sources');
eq(T.total(doc, 'watch'), 0, 'a step with no events is 0');
eq(T.total(null, 'land'), 0, 'no document is 0');
const msg = T.formatReport('2026-11-08', doc, 'https://x');
assert(msg.includes('8.11'), 'the date is in the message');
assert(msg.includes('נכנסו: 9, מתוכם מאינסטגרם: 7'), 'visits and Instagram share');
assert(msg.includes('נרשמו: 1'), 'sign-ups');
assert(msg.endsWith('https://x/?stats=1'), 'links to the screen');
assert(T.formatReport('2026-11-08', null, 'https://x').includes('נכנסו: 0'), 'a day with no document still reports');

// the browser's lists and the server's must not drift apart
const init = readFileSync(new URL('../web/firebase-init.js', import.meta.url), 'utf8');
const list = (name) => JSON.parse(init.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
eq(JSON.stringify(list('TK_STEPS')), JSON.stringify(T.STEPS), 'the same steps in the app and in the function');
eq(JSON.stringify(list('TK_SOURCES')), JSON.stringify(T.SOURCES), 'the same sources in the app and in the function');

// every step the screen shows is one the server accepts
const screen = readFileSync(new URL('../src/tracking.jsx', import.meta.url), 'utf8');
for (const s of T.STEPS) assert(screen.includes(`'${s}'`), `the screen shows ${s}`);

// the owner's list of sign-ups
assert(T.isOwnerToken({ email: 'Yaniv.Krispel@gmail.com', email_verified: true }), 'the owner may ask');
assert(!T.isOwnerToken({ email: 'yaniv.krispel@gmail.com', email_verified: false }), 'an unverified email may not');
assert(!T.isOwnerToken({ email: 'someone@gmail.com', email_verified: true }), 'nobody else may');
assert(!T.isOwnerToken(undefined), 'signed out may not');
eq(T.countPlans('{"plans":[{},{},{}]}'), 3, 'plans are counted');
eq(T.countPlans(''), 0, 'an empty store is 0');
eq(T.countPlans('{"plans":"x"}'), 0, 'a damaged store is 0');

const csvCode = screen.slice(screen.indexOf('function tkCsvCell'), screen.indexOf('// end of the spreadsheet helpers'));
const { tkCsvCell, tkCsv } = new Function(csvCode + '; return { tkCsvCell, tkCsv };')();
eq(tkCsvCell('a "b"'), '"a ""b"""', 'quotes are doubled');
eq(tkCsvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'a formula stays text');
eq(tkCsvCell('@x'), '"\'@x"', 'an @ start stays text');
eq(tkCsvCell(null), '""', 'an empty cell');
eq(tkCsv([['a', 1], ['b', 2]]), '﻿"a","1"\r\n"b","2"', 'rows, with the mark that makes Excel read Hebrew');

console.log(`tracking: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
