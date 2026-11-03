// Cloud Functions wiring for garmin.js. Loaded only when GARMIN_ENABLED=true (index.js).
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { createGarmin, GarminError } = require('./garmin');
const { readAllowList, isAllowed } = require('./garmin-core');

if (!admin.apps.length) admin.initializeApp();

const GARMIN_CLIENT_ID = defineSecret('GARMIN_CLIENT_ID');
const GARMIN_CLIENT_SECRET = defineSecret('GARMIN_CLIENT_SECRET');
const GARMIN_WEBHOOK_KEY = defineSecret('GARMIN_WEBHOOK_KEY');
const secrets = [GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET, GARMIN_WEBHOOK_KEY];

const APP_URL = 'https://raceplan.coachkrispel.com';
// the hosting rewrite /api/garmin/callback -> garminCallback keeps the consent on RacePlan's own domain
const REDIRECT_URI = APP_URL + '/api/garmin/callback';

// The closed list (functions/.env GARMIN_ALLOW, comma separated). Everyone else sees "coming soon".
const ALLOW = readAllowList(process.env.GARMIN_ALLOW);

const garmin = createGarmin({
  db: admin.firestore(),
  fetch: (...a) => fetch(...a),
  log: (...a) => console.warn(...a),
  config: () => {
    // 3.11.2026: the first GARMIN_CLIENT_ID was pasted twice (72 characters) and Garmin's consent page only said
    // "something went wrong". A Client ID is a UUID: anything else is refused here, and said so in the log.
    const clientId = String(GARMIN_CLIENT_ID.value() || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      console.error(`GARMIN_CLIENT_ID is not a UUID (${clientId.length} characters): set it again`);
      return null;
    }
    return {
      clientId, clientSecret: String(GARMIN_CLIENT_SECRET.value() || '').trim(),
      webhookKey: String(GARMIN_WEBHOOK_KEY.value() || '').trim(), redirectUri: REDIRECT_URI, appUrl: APP_URL,
    };
  },
});

const CODES = {
  unauthenticated: 'unauthenticated', not_configured: 'failed-precondition', not_connected: 'failed-precondition',
  reconnect: 'failed-precondition', noperm: 'permission-denied', rate_limited: 'resource-exhausted',
  bad_request: 'invalid-argument', bad_plan: 'invalid-argument', not_allowed: 'permission-denied',
};
// `open`: callable by anyone signed in (status, disconnect); otherwise only the closed list
const callable = (fn, open = false) => onCall({ secrets, enforceAppCheck: false }, async (req) => {
  try {
    const allowed = isAllowed(ALLOW, req.auth && req.auth.token);
    if (!open && !allowed) throw new GarminError(req.auth ? 'not_allowed' : 'unauthenticated');
    return await fn(req.auth && req.auth.uid, req.data || {}, allowed);
  }
  catch (e) {
    if (e instanceof GarminError) throw new HttpsError(CODES[e.code] || 'unavailable', e.code, { code: e.code, detail: e.detail });
    console.error('garmin', e);
    throw new HttpsError('internal', 'failed');
  }
});

exports.garminConnect = callable((uid) => garmin.connect(uid));
exports.garminStatus = callable(async (uid, _d, allowed) => ({ ...(await garmin.status(uid)), allowed }), true);
exports.garminPreview = callable((uid, data) => { if (!uid) throw new GarminError('unauthenticated'); return garmin.preview(data); });
exports.garminSend = callable((uid, data) => garmin.send(uid, data));
exports.garminDisconnect = callable((uid) => garmin.disconnect(uid), true);

exports.garminCallback = onRequest({ secrets }, async (req, res) => {
  let to;
  try { to = await garmin.callback(req.query || {}); }
  catch (e) { console.error('garmin callback', e); to = APP_URL + '/#garmin=failed'; }
  res.redirect(302, to);
});

exports.garminPush = onRequest({ secrets }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send(''); return; }
  try { res.status(await garmin.push(req.query || {}, req.body)).send(''); }
  catch (e) { console.error('garmin push', e); res.status(500).send(''); } // Garmin pushes again later
});
