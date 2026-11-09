const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const nodemailer = require('nodemailer');

// Set once via:
//   firebase functions:secrets:set GMAIL_USER
//   firebase functions:secrets:set GMAIL_APP_PASSWORD
const gmailUser = defineSecret('GMAIL_USER');
const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD');

const NOTIFY_TO = 'yaniv.krispel@gmail.com';
const APP_URL = 'https://raceplan.coachkrispel.com';

exports.notifyRouteSubmission = onDocumentCreated(
  { document: 'routeSubmissions/{id}', secrets: [gmailUser, gmailAppPassword] },
  async (event) => {
    const sub = event.data && event.data.data();
    if (!sub) return;

    const raceName = sub.raceName || sub.courseName || 'מרוץ ללא שם';
    const subject = sub.isNewRace
      ? `🆕 הצעת מרוץ חדש מהקהילה: ${raceName}`
      : `🏃 הצעת מסלול חדשה: ${raceName}`;

    const lines = [
      sub.isNewRace ? `מרוץ חדש שהוצע: ${raceName}` : `מסלול הוצע עבור: ${raceName}`,
      sub.courseName ? `שם המסלול: ${sub.courseName}` : null,
      `שולח/ת: ${sub.submitterName || 'לא ידוע'} (${sub.submitterEmail || 'לא ידוע'})`,
      sub.distanceKm ? `מרחק: ${sub.distanceKm} ק"מ` : null,
      sub.source ? `מקור: ${sub.source}` : null,
      sub.sourceUrl ? `קישור: ${sub.sourceUrl}` : null,
      '',
      'לאישור/דחייה: היכנס לאפליקציה ← ספריית מסלולים ← הצעות מהקהילה.',
      APP_URL,
    ].filter(Boolean);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser.value(), pass: gmailAppPassword.value() },
    });

    await transporter.sendMail({
      from: `RacePlan <${gmailUser.value()}>`,
      to: NOTIFY_TO,
      subject,
      text: lines.join('\n'),
    });
  }
);

// Anonymous funnel counters (POST /api/t) and, once its two secrets are set, the morning Telegram message.
Object.assign(exports, require('./tracking'));
Object.assign(exports, require('./users-activity'));
if (process.env.TELEGRAM_REPORT === 'true') {
  Object.assign(exports, require('./tracking-report'));
}

// ── Send to watch (Garmin Training API) ─────────────────────────────────
// OFF until RacePlan has its own Garmin app registration: GARMIN_ENABLED in functions/.env. While it is
// false these functions are not exported at all, so a functions deploy never asks for the Garmin
// secrets. To switch on (docs/GARMIN.md): set the three secrets, GARMIN_ENABLED=true, deploy functions,
// then add the /api/garmin/* hosting rewrites.
if (process.env.GARMIN_ENABLED === 'true') {
  Object.assign(exports, require('./garmin-functions'));
}
