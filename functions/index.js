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
