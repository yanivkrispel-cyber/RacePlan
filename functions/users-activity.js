// Callable for the owner's list of sign-ups (src/tracking.jsx). A person's plans and watch link are private even
// from the owner's browser, so this returns numbers only: how many plans, the watch state, how many sends.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { isOwnerToken, countPlans } = require('./tracking-core');

if (!admin.apps.length) admin.initializeApp();

exports.usersActivity = onCall({ region: 'us-central1', memory: '256MiB', maxInstances: 2 }, async (req) => {
  if (!isOwnerToken(req.auth && req.auth.token)) throw new HttpsError('permission-denied', 'owner only');
  const db = admin.firestore();
  const ids = (await db.collection('users').select().get()).docs.map((d) => d.id);
  if (!ids.length) return {};
  const [plans, links] = await Promise.all([
    db.getAll(...ids.map((id) => db.doc(`users/${id}/plans/data`))),
    db.getAll(...ids.map((id) => db.doc(`garminLinks/${id}`))),
  ]);
  const sent = await Promise.all(links.map((l) => (l.exists
    ? l.ref.collection('sent').count().get().then((s) => s.data().count)
    : 0)));
  const out = {};
  ids.forEach((id, i) => {
    out[id] = {
      plans: plans[i].exists ? countPlans(plans[i].get('json')) : 0,
      watch: links[i].exists ? (links[i].get('status') === 'linked' ? 'linked' : 'broken') : null,
      sent: sent[i],
    };
  });
  return out;
});
