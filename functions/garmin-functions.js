// Cloud Functions wiring for garmin.js. Loaded only when GARMIN_ENABLED=true (index.js).
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { createGarmin, GarminError } = require('./garmin');

if (!admin.apps.length) admin.initializeApp();

const GARMIN_CLIENT_ID = defineSecret('GARMIN_CLIENT_ID');
const GARMIN_CLIENT_SECRET = defineSecret('GARMIN_CLIENT_SECRET');
const GARMIN_WEBHOOK_KEY = defineSecret('GARMIN_WEBHOOK_KEY');
const secrets = [GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET, GARMIN_WEBHOOK_KEY];

const APP_URL = 'https://raceplan.coachkrispel.com';
// the hosting rewrite /api/garmin/callback -> garminCallback keeps the consent on RacePlan's own domain
const REDIRECT_URI = APP_URL + '/api/garmin/callback';

const garmin = createGarmin({
  db: admin.firestore(),
  fetch: (...a) => fetch(...a),
  log: (...a) => console.warn(...a),
  config: () => ({
    clientId: GARMIN_CLIENT_ID.value(), clientSecret: GARMIN_CLIENT_SECRET.value(),
    webhookKey: GARMIN_WEBHOOK_KEY.value(), redirectUri: REDIRECT_URI, appUrl: APP_URL,
  }),
});

const CODES = {
  unauthenticated: 'unauthenticated', not_configured: 'failed-precondition', not_connected: 'failed-precondition',
  reconnect: 'failed-precondition', noperm: 'permission-denied', rate_limited: 'resource-exhausted',
  bad_request: 'invalid-argument', bad_plan: 'invalid-argument',
};
const callable = (fn) => onCall({ secrets, enforceAppCheck: false }, async (req) => {
  try { return await fn(req.auth && req.auth.uid, req.data || {}); }
  catch (e) {
    if (e instanceof GarminError) throw new HttpsError(CODES[e.code] || 'unavailable', e.code, { code: e.code, detail: e.detail });
    console.error('garmin', e);
    throw new HttpsError('internal', 'failed');
  }
});

exports.garminConnect = callable((uid) => garmin.connect(uid));
exports.garminStatus = callable((uid) => garmin.status(uid));
exports.garminPreview = callable((uid, data) => { if (!uid) throw new GarminError('unauthenticated'); return garmin.preview(data); });
exports.garminSend = callable((uid, data) => garmin.send(uid, data));
exports.garminDisconnect = callable((uid) => garmin.disconnect(uid));

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
