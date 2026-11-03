// The whole "send to watch" flow (functions/garmin.js + garmin-core.js) against a fake Firestore and a
// fake Garmin: connect, the consent's return, refresh, send, send again, refusals, disconnect, pushes.
// Run with: node test/garmin.test.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const G = require('../functions/garmin-core.js');
const { createGarmin, GarminError } = require('../functions/garmin.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error(`  FAIL: ${msg}`); } }
function eq(a, b, msg) { assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function code(p) { try { await p; return 'ok'; } catch (e) { return e instanceof GarminError ? e.code : 'THREW ' + e.message; } }

// ---------------------------------------------------------------- a fake Firestore (what garmin.js uses)
function fakeDb() {
  const store = new Map(); // path -> data
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    async get() { const d = store.get(path); return { exists: d !== undefined, id: path.split('/').pop(), data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; },
    async set(v, o) { store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...v } : { ...v }); },
    async delete() { store.delete(path); },
    collection: (c) => colRef(path + '/' + c),
  });
  const colRef = (path) => {
    const docsUnder = () => [...store.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
    const snap = (keys) => ({ empty: !keys.length, docs: keys.map((k) => ({ id: k.split('/').pop(), ref: docRef(k), data: () => JSON.parse(JSON.stringify(store.get(k))) })) });
    return {
      doc: (id) => docRef(path + '/' + id),
      async get() { return snap(docsUnder()); },
      where: (f, op, v) => ({ limit: () => ({ async get() { return snap(docsUnder().filter((k) => store.get(k)[f] === v)); } }) }),
    };
  };
  return { store, collection: (c) => colRef(c) };
}

// ---------------------------------------------------------------- a fake Garmin
function fakeGarmin() {
  const g = { calls: [], workouts: new Map(), schedules: new Map(), nextId: 1000, perms: ['WORKOUT_IMPORT'], userId: 'garmin-user-1',
    tokenOk: true, refuseWorkout: null, refuseSchedule: null, issued: 0, deregistered: false };
  g.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    g.calls.push(`${method} ${url.replace(G.API_BASE, '')}`);
    const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
    if (url === G.TOKEN_URL) {
      if (!g.tokenOk) return res(400, { error: 'invalid_grant' });
      g.issued++;
      return res(200, { access_token: 'acc' + g.issued, refresh_token: 'ref' + g.issued, token_type: 'bearer', expires_in: 86400, refresh_token_expires_in: 7776000 });
    }
    const auth = (init.headers || {}).Authorization || '';
    if (!auth.startsWith('Bearer acc')) return res(401, { error: 'no token' });
    const path = url.replace(G.API_BASE, '');
    if (path === G.USER_ID_PATH) return res(200, { userId: g.userId });
    if (path === G.PERMISSIONS_PATH) return res(200, g.perms);
    if (path === G.WORKOUT_PATH && method === 'POST') {
      if (g.refuseWorkout) return res(g.refuseWorkout, { error: 'no' });
      const id = g.nextId++; g.workouts.set(id, JSON.parse(init.body)); return res(200, { workoutId: id });
    }
    if (path === G.SCHEDULE_PATH && method === 'POST') {
      if (g.refuseSchedule) return res(g.refuseSchedule, { error: 'no' });
      const b = JSON.parse(init.body); const id = g.nextId++; g.schedules.set(id, b); return res(200, id);
    }
    const m = path.match(/^\/training-api\/workout\/v2\/(\d+)$/);
    if (m && method === 'DELETE') { const had = g.workouts.delete(Number(m[1])); return res(had ? 204 : 404); }
    if (path === G.REGISTRATION_PATH && method === 'DELETE') { g.deregistered = true; return res(204); }
    return res(404, { error: 'unknown ' + path });
  };
  return g;
}

let clock = Date.parse('2027-02-01T08:00:00Z');
const CFG = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://raceplan.coachkrispel.com/api/garmin/callback', appUrl: 'https://raceplan.coachkrispel.com', webhookKey: 'hook' };
function setup(cfg = CFG) {
  const db = fakeDb(), garmin = fakeGarmin();
  const app = createGarmin({ db, fetch: garmin.fetch, now: () => clock, sleep: async () => {}, config: () => cfg });
  return { db, garmin, app };
}
const plan = (over = {}) => ({
  name: 'Tel Aviv Marathon', date: '2027-02-26', planId: 'p1',
  segments: Array.from({ length: 42 }, (_, i) => ({ distance: 1, paceSec: i < 5 ? 306 : 300 })).concat([{ distance: 0.2, paceSec: 300 }]),
  ...over,
});
async function connected(s) {
  const { url } = await s.app.connect('u1');
  const q = new URL(url).searchParams;
  return s.app.callback({ state: q.get('state'), code: 'the-code' });
}

console.log('\n── core ──');
{
  const v = G.newVerifier();
  assert(v.length >= 43 && v.length <= 128 && /^[A-Za-z0-9_-]+$/.test(v), 'a PKCE verifier is 43..128 base64url');
  // RFC 7636 appendix B
  eq(G.challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'S256 challenge matches RFC 7636');
  const u = new URL(G.authorizeUrl('cid', 'https://x/cb', 'st', 'ch'));
  eq(u.origin + u.pathname, G.AUTHORIZE_URL, 'authorize endpoint');
  eq(u.searchParams.get('code_challenge_method'), 'S256', 'S256');
  eq(G.readTokens({ access_token: 'a', refresh_token: 'r', expires_in: 10 }, 0), null, 'a 10 s token is refused');
  eq(G.readTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'mac' }, 0), null, 'a non-bearer token is refused');
  assert(G.refreshDue(new Date(clock + 30 * 60_000).toISOString(), clock), 'half an hour left: refresh');
  assert(!G.refreshDue(new Date(clock + 5 * 3600_000).toISOString(), clock), 'five hours left: no refresh');
  eq(G.readId(123, 'scheduleId'), 123, 'a bare number id');
  eq(G.readId({ workoutId: '77' }, 'workoutId'), 77, 'a workoutId');
  eq(G.readId({ workoutId: -1 }, 'workoutId'), null, 'a bad id');
  eq(G.backTo('https://a/', 'connected'), 'https://a/#garmin=connected', 'back to the app');
  eq(G.backTo('https://a', 'evil<script>'), 'https://a/#garmin=failed', 'only known results go back');
  const ok = G.readSendRequest(plan(), '2027-02-01');
  eq(ok.problems.length, 0, 'a good request');
  eq(ok.key, 'race-p1-2027-02-26', 'its key');
  eq(G.readSendRequest(plan({ date: '2027-01-15' }), '2027-02-01').problems[0], 'past', 'a past race is refused');
  eq(G.readSendRequest(plan({ date: '2027-01-31' }), '2027-02-01').problems.length, 0, 'yesterday (UTC) still counts (time zones)');
  eq(G.readSendRequest(plan({ date: '2028-06-01' }), '2027-02-01').problems[0], 'too_far', 'more than a year ahead');
  eq(G.readSendRequest(plan({ date: '2027-02-30' }), '2027-02-01').problems.length, 0, 'the date check is format + parse (Feb 30 parses: Garmin decides)');
  eq(G.readSendRequest(plan({ segments: [] }), '2027-02-01').problems[0], 'segments', 'no segments');
  const r = G.readSendRequest(plan({ opts: { tolSec: 999, lang: 'xx', fastOnly: 'yes', evil: 1, cues: { 0: 'x'.repeat(50), a: 'no' } } }), '2027-02-01');
  eq(r.plan.opts.tolSec, 20, 'tolerance capped');
  eq(r.plan.opts.fastOnly, false, 'only true is true');
  eq(r.plan.opts.evil, undefined, 'unknown options dropped');
  eq(r.plan.opts.cues[0].length, 24, 'cues cut to 24');
  eq(r.plan.opts.cues.a, undefined, 'cue keys are indexes');
  eq(G.readSendRequest(plan({ kind: 'rehearsal' }), '2027-02-01').plan.name, 'Rehearsal: Tel Aviv Marathon', 'a rehearsal is named so');
  const pushes = G.readAccountPush({ deregistrations: [{ userId: 'a' }], userPermissionsChange: [{ userId: 'b', permissions: ['ACTIVITY_EXPORT'] }], other: [1] });
  eq(pushes.length, 2, 'two account pushes read');
  eq(pushes[1].permissions[0], 'ACTIVITY_EXPORT', 'with the new permissions');
}

console.log('\n── off until configured ──');
{
  const s = setup(null);
  eq(await code(s.app.connect('u1')), 'not_configured', 'connect without keys');
  eq(await code(s.app.send('u1', plan())), 'not_configured', 'send without keys');
  eq((await s.app.status('u1')).configured, false, 'status says so');
  eq(await code(setup().app.connect(null)), 'unauthenticated', 'signed out: refused');
}

console.log('\n── connect ──');
{
  const s = setup();
  const { url } = await s.app.connect('u1');
  const q = new URL(url).searchParams;
  eq(q.get('client_id'), 'cid', 'our client id');
  eq(q.get('redirect_uri'), CFG.redirectUri, 'our redirect');
  const st = s.db.store.get('garminOAuth/' + q.get('state'));
  eq(st.uid, 'u1', 'the state remembers the user');
  eq(G.challengeOf(st.verifier), q.get('code_challenge'), 'the challenge is the verifier\'s');
  eq(await s.app.callback({ state: q.get('state'), code: 'c' }), 'https://raceplan.coachkrispel.com/#garmin=connected', 'connected');
  eq(s.db.store.get('garminLinks/u1').garminUserId, 'garmin-user-1', 'the link holds the Garmin user');
  eq(s.db.store.get('garminTokens/u1').access, 'acc1', 'the tokens are kept server-side');
  assert(!('access' in s.db.store.get('garminLinks/u1')), 'no token in the doc the user can read');
  eq(s.db.store.has('garminOAuth/' + q.get('state')), false, 'the state is used up');
  eq(await s.app.callback({ state: q.get('state'), code: 'c' }), CFG.appUrl + '/#garmin=expired', 'a replayed callback finds nothing');
  const st2 = await s.app.status('u1');
  eq(st2.connected && st2.canSend, true, 'status: connected, can send');
}
{
  const s = setup();
  const { url } = await s.app.connect('u1');
  const st = new URL(url).searchParams.get('state');
  eq(await s.app.callback({ state: st, error: 'access_denied' }), CFG.appUrl + '/#garmin=denied', 'the runner said no');
  const { url: u2 } = await s.app.connect('u1');
  clock += 11 * 60_000;
  eq(await s.app.callback({ state: new URL(u2).searchParams.get('state'), code: 'c' }), CFG.appUrl + '/#garmin=expired', 'eleven minutes later: expired');
  clock -= 11 * 60_000;
  eq(await s.app.callback({ state: 'made-up', code: 'c' }), CFG.appUrl + '/#garmin=expired', 'an unknown state');
  eq(await s.app.callback({}), CFG.appUrl + '/#garmin=failed', 'no state at all');
  s.garmin.tokenOk = false;
  const { url: u3 } = await s.app.connect('u1');
  eq(await s.app.callback({ state: new URL(u3).searchParams.get('state'), code: 'c' }), CFG.appUrl + '/#garmin=failed', 'the token exchange failed');
}
{
  const s = setup();
  await connected(s);
  const { url } = await s.app.connect('u2');
  eq(await s.app.callback({ state: new URL(url).searchParams.get('state'), code: 'c' }), CFG.appUrl + '/#garmin=taken', 'the same Garmin account on a second RacePlan account: refused');
  const s2 = setup();
  s2.garmin.perms = ['ACTIVITY_EXPORT'];
  eq(await connected(s2), CFG.appUrl + '/#garmin=noperm', 'connected without the workouts permission: said so');
  eq((await s2.app.status('u1')).canSend, false, 'and cannot send');
}

console.log('\n── send ──');
{
  const s = setup();
  eq(await code(s.app.send('u1', plan())), 'not_connected', 'not connected yet');
  await connected(s);
  const r = await s.app.send('u1', plan());
  eq(r.ok, true, 'sent');
  const w = s.garmin.workouts.get(r.workoutId);
  eq(w.sport, 'RUNNING', 'Garmin got a running workout');
  assert(w.segments[0].steps.length >= 2 && w.segments[0].steps.length <= 7, `a marathon in 2..7 steps (${w.segments[0].steps.length})`);
  eq(s.garmin.schedules.get(r.scheduleId).date, '2027-02-26', 'scheduled on race day');
  eq(s.garmin.schedules.get(r.scheduleId).workoutId, r.workoutId, 'the schedule is that workout');
  eq(s.db.store.get('garminLinks/u1/sent/race-p1-2027-02-26').workoutId, r.workoutId, 'the send is recorded');
  eq(s.db.store.get('garminLinks/u1').sendCount, 1, 'counted');

  const again = await s.app.send('u1', plan({ segments: plan().segments.map((x) => ({ ...x, paceSec: x.paceSec - 5 })) }));
  eq(s.garmin.workouts.has(r.workoutId), false, 'sending again takes the earlier workout off');
  eq(s.garmin.workouts.size, 1, 'one race-day workout on the watch, not two');
  assert(again.workoutId !== r.workoutId, 'the new one is there');

  const reh = await s.app.send('u1', plan({ kind: 'rehearsal', rehearsalKm: 28, date: '2027-02-08' }));
  const rw = s.garmin.workouts.get(reh.workoutId);
  eq(rw.workoutName, 'Rehearsal: Tel Aviv Marathon', 'the rehearsal has its own name');
  eq(s.garmin.workouts.size, 2, 'a rehearsal does not replace the race');
  eq(await code(s.app.send('u1', plan({ kind: 'rehearsal', rehearsalKm: 2 }))), 'bad_request', 'a 2 km rehearsal is refused');
  eq(await code(s.app.send('u1', plan({ date: '2027-01-01' }))), 'bad_request', 'a past race is refused');
  eq(await code(s.app.send('u1', plan({ segments: [{ distance: 5, paceSec: 30 }] }))), 'bad_plan', 'an impossible pace is refused');

}
{
  // the preview equals the sent workout for the same plan
  const s = setup(); await connected(s);
  const r = await s.app.send('u1', plan());
  eq(JSON.stringify(s.app.preview(plan()).workout), JSON.stringify(s.garmin.workouts.get(r.workoutId)), 'the preview is exactly what Garmin received');
}
{
  const s = setup(); await connected(s);
  // an expired access token refreshes before the call, and both tokens rotate
  s.db.store.get('garminTokens/u1').accessExp = new Date(clock - 1000).toISOString();
  await s.app.send('u1', plan());
  eq(s.db.store.get('garminTokens/u1').refresh, 'ref2', 'refresh token rotated');
  // a refresh Garmin refuses: the link is broken and the runner is asked to connect again
  s.db.store.get('garminTokens/u1').accessExp = new Date(clock - 1000).toISOString();
  s.garmin.tokenOk = false;
  eq(await code(s.app.send('u1', plan())), 'reconnect', 'refresh refused: reconnect');
  eq(s.db.store.get('garminLinks/u1').status, 'broken', 'the link is marked broken');
  eq(await code(s.app.send('u1', plan())), 'reconnect', 'and stays so');
  eq((await s.app.status('u1')).broken, true, 'status says broken');
}
{
  const s = setup(); await connected(s);
  s.garmin.refuseWorkout = 412;
  s.garmin.perms = [];
  eq(await code(s.app.send('u1', plan())), 'noperm', 'WORKOUT_IMPORT taken away at Garmin: noperm');
  s.garmin.refuseWorkout = 500;
  eq(await code(s.app.send('u1', plan())), 'workout_failed', 'a Garmin error: workout_failed');
  s.garmin.refuseWorkout = null; s.garmin.refuseSchedule = 500;
  eq(await code(s.app.send('u1', plan())), 'schedule_failed', 'the schedule failed');
  eq(s.garmin.workouts.size, 0, 'and the unscheduled workout was taken off again');
}
{
  const s = setup(); await connected(s);
  for (let i = 0; i < G.SENDS_PER_DAY; i++) await s.app.send('u1', plan());
  eq(await code(s.app.send('u1', plan())), 'rate_limited', `${G.SENDS_PER_DAY} sends a day, then rate_limited`);
  clock += 24 * 3600_000;
  eq(await code(s.app.send('u1', plan())), 'ok', 'the next day it works again');
  clock -= 24 * 3600_000;
}

console.log('\n── disconnect and Garmin pushes ──');
{
  const s = setup(); await connected(s);
  await s.app.send('u1', plan());
  const r = await s.app.disconnect('u1');
  eq(r.removed, 1, 'the race-day workout still ahead is taken off');
  eq(s.garmin.deregistered, true, 'the registration is deleted at Garmin');
  eq(s.db.store.size, 0, 'nothing of the runner is left (link, tokens, sends)');
  eq(await code(s.app.disconnect('u1')), 'ok', 'disconnecting twice is fine');
}
{
  const s = setup(); await connected(s);
  await s.app.send('u1', plan());
  eq(await s.app.push({ k: 'wrong' }, { deregistrations: [{ userId: 'garmin-user-1' }] }), 401, 'a push without our key is refused');
  eq(s.db.store.has('garminLinks/u1'), true, 'and changes nothing');
  eq(await s.app.push({ k: 'hook' }, { userPermissionsChange: [{ userId: 'garmin-user-1', permissions: ['ACTIVITY_EXPORT'] }] }), 200, 'a permission change');
  eq((await s.app.status('u1')).canSend, false, 'is taken in');
  eq(await s.app.push({ k: 'hook' }, { deregistrations: [{ userId: 'garmin-user-1' }] }), 200, 'a deregistration');
  eq(s.db.store.size, 0, 'removes everything');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
