// garmin.js — RacePlan's "send to watch": the Garmin connection and the send, with every dependency handed
// in (Firestore, fetch, the clock, the keys), so test/garmin.test.mjs runs the whole flow against a fake
// Firestore and a fake Garmin. index.js wires it to Cloud Functions.
//
// Firestore (server only; the rules let a user GET their own garminLinks doc and its sent/ docs, nothing else):
//   garminOAuth/{state}        { uid, verifier, createdAt }            one use, 10 minutes
//   garminTokens/{uid}         { access, refresh, accessExp, refreshExp }
//   garminLinks/{uid}          { garminUserId, status: linked|broken, permissions, connectedAt, updatedAt, sendDay, sendCount }
//   garminLinks/{uid}/sent/{k} { kind, name, date, workoutId, scheduleId, sentAt, blocks }

const G = require('./garmin-core');
const WP = require('./watchplan');

class GarminError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || null; }
}

function createGarmin(deps) {
  const { db, fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = deps;
  const cfg = () => deps.config();
  const configured = () => { const c = cfg(); return !!(c && c.clientId && c.clientSecret && c.redirectUri && c.appUrl); };
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const links = () => db.collection('garminLinks');
  const tokensRef = (uid) => db.collection('garminTokens').doc(uid);

  async function api(token, method, path, body) {
    const res = await fetch(path.startsWith('https://') ? path : G.API_BASE + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data = null;
    try { const t = await res.text(); data = t ? JSON.parse(t) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  }

  async function postToken(body) {
    const res = await fetch(G.TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    let ans = null;
    try { ans = await res.json(); } catch { ans = null; }
    return { status: res.status, tok: res.ok ? G.readTokens(ans, now()) : null };
  }

  // ------------------------------------------------------------ connect
  async function connect(uid) {
    if (!uid) throw new GarminError('unauthenticated');
    if (!configured()) throw new GarminError('not_configured');
    const c = cfg();
    const verifier = G.newVerifier();
    const state = G.newState();
    await db.collection('garminOAuth').doc(state).set({ uid, verifier, createdAt: now() });
    return { url: G.authorizeUrl(c.clientId, c.redirectUri, state, G.challengeOf(verifier)) };
  }

  /** The consent's return: always a URL to send the browser back to. */
  async function callback(query) {
    if (!configured()) return G.backTo(cfg() && cfg().appUrl || '', 'failed');
    const c = cfg();
    const back = (r) => G.backTo(c.appUrl, r);
    const state = typeof query.state === 'string' ? query.state : '';
    if (!state || state.length > 100) return back('failed');
    const ref = db.collection('garminOAuth').doc(state);
    const snap = await ref.get();
    if (!snap.exists) { log('garmin callback: unknown or used state'); return back('expired'); }
    await ref.delete(); // once: a replayed callback finds nothing
    const st = snap.data();
    if (!st || !st.uid || !st.verifier || now() - Number(st.createdAt) > G.STATE_TTL_MS) return back('expired');
    if (query.error || typeof query.code !== 'string' || !query.code) {
      // what Garmin said, never the code itself (a short, sanitised word)
      log('garmin callback: no code', String(query.error || 'none').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60));
      return back('denied');
    }

    const { tok, status } = await postToken(G.tokenRequestBody(c.clientId, c.clientSecret, query.code, st.verifier, c.redirectUri));
    if (!tok) { log('garmin token exchange failed', status); return back('failed'); }
    const idA = await api(tok.access, 'GET', G.USER_ID_PATH);
    const garminUserId = idA.ok ? G.readUserId(idA.data) : null;
    if (!garminUserId) { log('garmin callback: user id failed', idA.status); return back('failed'); }

    // one Garmin account belongs to one RacePlan account at a time
    const other = await links().where('garminUserId', '==', garminUserId).limit(5).get();
    if (other.docs.some((d) => d.id !== st.uid && d.data().status === 'linked')) return back('taken');
    for (const d of other.docs) if (d.id !== st.uid) await d.ref.delete();

    let perms = await readPerms(tok.access);
    if (!perms.length) { await sleep(2000); perms = await readPerms(tok.access); } // the first read can come back empty
    const at = new Date(now()).toISOString();
    await tokensRef(st.uid).set({ access: tok.access, refresh: tok.refresh, accessExp: tok.accessExp, refreshExp: tok.refreshExp });
    await links().doc(st.uid).set({ garminUserId, status: 'linked', permissions: perms, connectedAt: at, updatedAt: at }, { merge: true });
    return back(perms.length && !perms.includes(G.WORKOUT_IMPORT) ? 'noperm' : 'connected');
  }

  async function readPerms(access) {
    const a = await api(access, 'GET', G.PERMISSIONS_PATH);
    return a.ok ? G.readPermissions(a.data) : [];
  }

  // ------------------------------------------------------------ tokens
  async function tokenFor(uid, force = false) {
    const snap = await tokensRef(uid).get();
    const t = snap.exists ? snap.data() : null;
    if (!t || !t.access || !t.refresh) throw new GarminError('not_connected');
    if (!force && !G.refreshDue(t.accessExp, now())) return t.access;
    const c = cfg();
    const { tok } = await postToken(G.refreshRequestBody(c.clientId, c.clientSecret, t.refresh));
    if (!tok) {
      await links().doc(uid).set({ status: 'broken', updatedAt: new Date(now()).toISOString() }, { merge: true });
      throw new GarminError('reconnect');
    }
    // Garmin rotates the refresh token on every refresh: both are written together
    await tokensRef(uid).set({ access: tok.access, refresh: tok.refresh, accessExp: tok.accessExp, refreshExp: tok.refreshExp });
    return tok.access;
  }

  /** A call as the user; a 401 gets one fresh token and one more try. */
  async function callAs(uid, method, path, body) {
    let a = await api(await tokenFor(uid), method, path, body);
    if (a.status === 401) a = await api(await tokenFor(uid, true), method, path, body);
    return a;
  }

  // ------------------------------------------------------------ status, preview, send
  async function status(uid) {
    if (!uid) throw new GarminError('unauthenticated');
    const snap = await links().doc(uid).get();
    const l = snap.exists ? snap.data() : null;
    return {
      configured: configured(),
      connected: !!(l && l.status === 'linked'),
      broken: !!(l && l.status === 'broken'),
      canSend: !!(l && l.status === 'linked' && (!l.permissions || !l.permissions.length || l.permissions.includes(G.WORKOUT_IMPORT))),
    };
  }

  function build(data) {
    const req = G.readSendRequest(data, today());
    if (req.problems.length) throw new GarminError('bad_request', req.problems);
    if (req.kind === 'rehearsal') {
      const km = Number(data.rehearsalKm);
      if (!(km >= 5 && km <= 45)) throw new GarminError('bad_request', ['rehearsalKm']);
      req.plan.segments = WP.rehearsalOf(req.plan.segments, km);
    }
    const b = WP.toGarminWorkout(req.plan);
    if (!b.workout) throw new GarminError('bad_plan', b.problems);
    return { req, b };
  }

  async function send(uid, data) {
    if (!uid) throw new GarminError('unauthenticated');
    if (!configured()) throw new GarminError('not_configured');
    const linkRef = links().doc(uid);
    const ls = await linkRef.get();
    const link = ls.exists ? ls.data() : null;
    if (!link || link.status !== 'linked') throw new GarminError(link && link.status === 'broken' ? 'reconnect' : 'not_connected');
    const day = today();
    const count = link.sendDay === day ? Number(link.sendCount) || 0 : 0;
    if (count >= G.SENDS_PER_DAY) throw new GarminError('rate_limited');

    const { req, b } = build(data);
    const sentRef = linkRef.collection('sent').doc(req.key);
    const prev = await sentRef.get();
    if (prev.exists && prev.data().workoutId) {
      const d = await callAs(uid, 'DELETE', G.WORKOUT_ONE_PATH(prev.data().workoutId));
      if (!d.ok && d.status !== 404) log('garmin delete of the previous workout failed', d.status);
    }

    const created = await callAs(uid, 'POST', G.WORKOUT_PATH, b.workout);
    if (!created.ok) throw await refused(uid, linkRef, created.status, 'workout_failed');
    const workoutId = G.readId(created.data, 'workoutId');
    if (!workoutId) throw new GarminError('workout_failed');
    const sch = await callAs(uid, 'POST', G.SCHEDULE_PATH, G.scheduleBody(workoutId, req.plan.date));
    const scheduleId = sch.ok ? G.readId(sch.data, 'scheduleId') : null;
    if (!scheduleId) {
      await callAs(uid, 'DELETE', G.WORKOUT_ONE_PATH(workoutId)); // no half-sent workout left behind
      throw await refused(uid, linkRef, sch.status, 'schedule_failed');
    }

    const at = new Date(now()).toISOString();
    const blocks = b.blocks.map((x) => ({ startKm: x.startKm, endKm: x.endKm, paceSec: Math.round(x.paceSec), fastSec: x.fastSec, slowSec: x.slowSec, cue: x.cue, kind: x.kind }));
    await sentRef.set({ kind: req.kind, name: req.plan.name, date: req.plan.date, workoutId, scheduleId, sentAt: at, blocks });
    await linkRef.set({ sendDay: day, sendCount: count + 1, updatedAt: at }, { merge: true });
    return { ok: true, workoutId, scheduleId, date: req.plan.date, kind: req.kind, blocks, notes: b.notes };
  }

  async function refused(uid, linkRef, statusCode, fallback) {
    const why = G.refusalOf(statusCode);
    if (why === 'permission') {
      const t = await tokenFor(uid).catch(() => null);
      const perms = t ? await readPerms(t) : [];
      await linkRef.set({ permissions: perms, updatedAt: new Date(now()).toISOString() }, { merge: true });
      return new GarminError('noperm');
    }
    if (why === 'token') {
      await linkRef.set({ status: 'broken', updatedAt: new Date(now()).toISOString() }, { merge: true });
      return new GarminError('reconnect');
    }
    log('garmin refused', statusCode);
    return new GarminError(fallback, { status: statusCode });
  }

  // ------------------------------------------------------------ disconnect, Garmin's pushes
  async function forget(uid) {
    const linkRef = links().doc(uid);
    const sent = await linkRef.collection('sent').get();
    for (const d of sent.docs) await d.ref.delete();
    await linkRef.delete();
    await tokensRef(uid).delete();
  }

  async function disconnect(uid) {
    if (!uid) throw new GarminError('unauthenticated');
    const linkRef = links().doc(uid);
    const sent = await linkRef.collection('sent').get();
    let removed = 0;
    try {
      // the race-day workouts still ahead are taken off the watch; past ones are the runner's history
      for (const d of sent.docs) {
        const s = d.data();
        if (s.workoutId && s.date >= today()) { const r = await callAs(uid, 'DELETE', G.WORKOUT_ONE_PATH(s.workoutId)); if (r.ok) removed++; }
      }
      await callAs(uid, 'DELETE', G.REGISTRATION_PATH);
    } catch (e) {
      if (!(e instanceof GarminError)) throw e; // a broken link still disconnects here
    }
    await forget(uid);
    return { ok: true, removed };
  }

  /** Garmin's account pushes (deregistrations, userPermissionsChange). Answers an HTTP status. */
  async function push(query, body) {
    const c = cfg();
    if (!c || !c.webhookKey || query.k !== c.webhookKey) return 401;
    for (const ev of G.readAccountPush(body)) {
      const found = await links().where('garminUserId', '==', ev.userId).limit(5).get();
      for (const d of found.docs) {
        if (ev.kind === 'deregistration') await forget(d.id);
        else await d.ref.set({ permissions: ev.permissions, updatedAt: new Date(now()).toISOString() }, { merge: true });
      }
    }
    return 200;
  }

  return { connect, callback, status, preview: (data) => { const { b } = build(data); return { blocks: b.blocks, workout: b.workout, notes: b.notes }; }, send, disconnect, push, tokenFor };
}

module.exports = { createGarmin, GarminError };
