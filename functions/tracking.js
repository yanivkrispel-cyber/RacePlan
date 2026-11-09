// POST /api/t (hosting rewrite): one anonymous funnel event from the app. See tracking-core.js.
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { parseEvent, docId, statsPatch, MAX_BODY } = require('./tracking-core');

if (!admin.apps.length) admin.initializeApp();

const APP_ORIGIN = 'https://raceplan.coachkrispel.com';

exports.track = onRequest({ region: 'us-central1', memory: '256MiB', maxInstances: 5, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send(''); return; }
  const origin = req.get('origin');
  if (origin && origin !== APP_ORIGIN) { res.status(403).send(''); return; }
  if (req.rawBody && req.rawBody.length > MAX_BODY) { res.status(413).send(''); return; }
  const ev = parseEvent(typeof req.body === 'string' || (req.body && req.body.step) ? req.body : String(req.rawBody || ''));
  if (!ev) { res.status(400).send(''); return; }
  try {
    const { FieldValue } = admin.firestore;
    await admin.firestore().doc(`stats/${docId(ev, new Date())}`).set({
      ...statsPatch(ev, FieldValue.increment(1)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    res.status(204).send('');
  } catch (e) {
    console.error('track', e && e.message);
    res.status(500).send('');
  }
});
