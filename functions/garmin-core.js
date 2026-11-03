// garmin-core.js — RacePlan's own Garmin connection (Training API only: WORKOUT_IMPORT), everything that is
// not a network call. Pure, so it is unit-tested without a key (test/garmin.test.mjs).
//
// Ported from the coach app's tested adapter (AtheletsPayStats supabase/functions/_shared/garmin.ts, from
// Garmin's "OAuth2 PKCE" spec and "Training API V2" 2.0, read 24.10.2026). RacePlan is a SEPARATE app
// registration on Garmin's portal (council 26.10.2026: one notification URL per app, and the coach app's
// approval covers up to 100 coached athletes, not a public tool), so it has its own client id and secret.
//
// NOT YET RUN AGAINST GARMIN: the first real send (on Kris's watch) is the check. Every endpoint is a
// constant here.

const crypto = require('node:crypto');

const AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
const TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const API_BASE = 'https://apis.garmin.com';
const USER_ID_PATH = '/wellness-api/rest/user/id';
const PERMISSIONS_PATH = '/wellness-api/rest/user/permissions';
const REGISTRATION_PATH = '/wellness-api/rest/user/registration';
const WORKOUT_PATH = '/workoutportal/workout/v2';
const WORKOUT_ONE_PATH = (id) => `/training-api/workout/v2/${id}`;
const SCHEDULE_PATH = '/training-api/schedule/';
const WORKOUT_IMPORT = 'WORKOUT_IMPORT';
const STATE_TTL_MS = 10 * 60_000;
const SENDS_PER_DAY = 20; // one runner's sends a day: a public tool must not burn the app's quota

// ---------------------------------------------------------------- PKCE
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A code verifier: 64 characters of base64url (RFC 7636 allows 43 to 128). */
const newVerifier = (rand = (n) => crypto.randomBytes(n)) => b64url(rand(48));
/** S256: base64url(sha256(verifier)). */
const challengeOf = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());
/** The state: random, single use, kept server-side with the uid and the verifier. */
const newState = (rand = (n) => crypto.randomBytes(n)) => b64url(rand(24));

function authorizeUrl(clientId, redirectUri, state, challenge) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirectUri, state });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}
const tokenRequestBody = (clientId, clientSecret, code, verifier, redirectUri) =>
  new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri }).toString();
const refreshRequestBody = (clientId, clientSecret, refreshToken) =>
  new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }).toString();

// ---------------------------------------------------------------- tokens
/** { access_token, token_type: bearer, refresh_token, expires_in, refresh_token_expires_in } -> tokens, or null. */
function readTokens(body, nowMs) {
  const b = body || {};
  const access = typeof b.access_token === 'string' ? b.access_token : '';
  const refresh = typeof b.refresh_token === 'string' ? b.refresh_token : '';
  const exp = Number(b.expires_in);
  if (!access || !refresh || access.length > 4000 || refresh.length > 4000 || !(exp > 60)) return null;
  if (b.token_type != null && String(b.token_type).toLowerCase() !== 'bearer') return null;
  const rexp = Number(b.refresh_token_expires_in);
  return {
    access, refresh,
    accessExp: new Date(nowMs + (exp - 60) * 1000).toISOString(),
    refreshExp: rexp > 0 ? new Date(nowMs + (rexp - 60) * 1000).toISOString() : null,
  };
}
/** Refresh when the access token has less than `marginMs` left (or no expiry is known). */
function refreshDue(accessExp, nowMs, marginMs = 60 * 60_000) {
  const t = Date.parse(String(accessExp || ''));
  return !Number.isFinite(t) || t - nowMs < marginMs;
}
function readUserId(body) {
  const id = body && body.userId;
  return typeof id === 'string' && id.length >= 1 && id.length <= 100 ? id : null;
}
function readPermissions(body) {
  const arr = Array.isArray(body) ? body : Array.isArray(body && body.permissions) ? body.permissions : [];
  return [...new Set(arr.filter((x) => typeof x === 'string' && /^[A-Z_]{3,40}$/.test(x)))].sort();
}
/** Garmin's create answer carries { workoutId }; the schedule's, its id (a number). */
function readId(body, key) {
  const v = typeof body === 'number' ? body : body && (body[key] != null ? body[key] : body.id);
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
/** 401: the token is gone; 403 / 412: the runner took WORKOUT_IMPORT away at Garmin. */
function refusalOf(status) {
  if (status === 401) return 'token';
  if (status === 403 || status === 412) return 'permission';
  return null;
}
const scheduleBody = (workoutId, date) => ({ workoutId, date });

// ---------------------------------------------------------------- what the app asks
/** Where the browser lands after the consent: the app, with what happened. */
const RESULTS = new Set(['connected', 'denied', 'expired', 'failed', 'taken', 'noperm']);
const backTo = (appUrl, r) => `${String(appUrl).replace(/\/+$/, '')}/#garmin=${RESULTS.has(r) ? r : 'failed'}`;

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * The app's "send to watch" request, checked: { plan, key, problems }. Only the plan's raw numbers are
 * taken; the server builds the workout itself (watchplan.js), never trusting one built in the browser.
 *   data = { name, date, segments: [{distance, paceSec}], profile?: [{d, ele}], opts?, kind?: 'race'|'rehearsal', planId? }
 */
const OPT_KEYS = ['tolSec', 'fastOnly', 'slowOpenSec', 'firstNotFaster', 'driftPct', 'openLast', 'maxBlocks', 'cues'];
function readSendRequest(data, today) {
  const d = data || {};
  const problems = [];
  if (!isDay(d.date)) problems.push('date');
  // the user's own day may be a day behind UTC: yesterday (UTC) still counts as today
  else if (d.date < addDays(today, -1)) problems.push('past');
  else if (d.date > addDays(today, 366)) problems.push('too_far');
  if (!Array.isArray(d.segments) || !d.segments.length || d.segments.length > 400) problems.push('segments');
  const segments = Array.isArray(d.segments)
    ? d.segments.slice(0, 400).map((s) => ({ distance: Number(s && s.distance), paceSec: Number(s && s.paceSec) }))
    : [];
  let profile = null;
  if (Array.isArray(d.profile) && d.profile.length >= 2) {
    if (d.profile.length > 3000) problems.push('profile');
    else profile = d.profile.map((p) => ({ d: Number(p && p.d), ele: Number(p && p.ele) })).filter((p) => isFinite(p.d) && isFinite(p.ele));
  }
  const opts = {};
  if (d.opts && typeof d.opts === 'object') {
    for (const k of OPT_KEYS) if (d.opts[k] !== undefined) opts[k] = d.opts[k];
    if (opts.cues != null) {
      const c = {};
      if (typeof opts.cues === 'object') for (const [i, v] of Object.entries(opts.cues)) if (/^\d{1,2}$/.test(i) && typeof v === 'string') c[i] = v.slice(0, 24);
      opts.cues = c;
    }
    for (const k of ['tolSec', 'slowOpenSec', 'driftPct', 'maxBlocks']) if (opts[k] != null && !Number.isFinite(Number(opts[k]))) delete opts[k];
    if (opts.tolSec != null) opts.tolSec = Math.min(20, Math.max(2, Number(opts.tolSec)));
    if (opts.slowOpenSec != null) opts.slowOpenSec = Math.min(120, Math.max(5, Number(opts.slowOpenSec)));
    if (opts.maxBlocks != null) opts.maxBlocks = Math.min(20, Math.max(1, Math.round(Number(opts.maxBlocks))));
    for (const k of ['fastOnly', 'firstNotFaster', 'openLast']) if (opts[k] != null) opts[k] = opts[k] === true;
  }
  const kind = d.kind === 'rehearsal' ? 'rehearsal' : 'race';
  const name = String(d.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 70);
  const plan = { name: kind === 'rehearsal' ? `Rehearsal: ${name || 'race'}` : name, date: d.date, segments, profile, opts };
  // one record per plan and kind: sending again replaces the earlier workout on the watch
  const key = `${kind}-${String(d.planId || name || 'plan').replace(/[^A-Za-z0-9_֐-׿-]+/g, '_').slice(0, 60)}-${d.date}`;
  return { plan, key, kind, problems };
}

/** A Garmin push (deregistrations, userPermissionsChange) as [{ userId, kind, permissions? }]. */
function readAccountPush(body) {
  const out = [];
  const b = body || {};
  for (const it of Array.isArray(b.deregistrations) ? b.deregistrations : []) {
    if (it && typeof it.userId === 'string') out.push({ userId: it.userId, kind: 'deregistration' });
  }
  for (const it of Array.isArray(b.userPermissionsChange) ? b.userPermissionsChange : []) {
    if (it && typeof it.userId === 'string') out.push({ userId: it.userId, kind: 'permissions', permissions: readPermissions(it.permissions) });
  }
  return out;
}

/** The closed list (Kris 3.11.2026: Garmin for the owner and chosen athletes first). A verified Google email only. */
function readAllowList(env) {
  return new Set(String(env || '').toLowerCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+$/.test(x)));
}
function isAllowed(list, token) {
  if (!token || token.email_verified !== true || typeof token.email !== 'string') return false;
  return list.has(token.email.toLowerCase());
}

module.exports = {
  AUTHORIZE_URL, TOKEN_URL, API_BASE, USER_ID_PATH, PERMISSIONS_PATH, REGISTRATION_PATH, WORKOUT_PATH, WORKOUT_ONE_PATH,
  SCHEDULE_PATH, WORKOUT_IMPORT, STATE_TTL_MS, SENDS_PER_DAY,
  newVerifier, challengeOf, newState, authorizeUrl, tokenRequestBody, refreshRequestBody,
  readTokens, refreshDue, readUserId, readPermissions, readId, refusalOf, scheduleBody,
  backTo, isDay, addDays, readSendRequest, readAccountPush, readAllowList, isAllowed,
};
