// Every morning at 08:00 Israel time: yesterday's funnel to Kris on Telegram.
// Exported only when TELEGRAM_REPORT=true in functions/.env (index.js), after these two are set:
//   firebase functions:secrets:set TELEGRAM_BOT_TOKEN
//   firebase functions:secrets:set TELEGRAM_CHAT_ID
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { dayKey, formatReport } = require('./tracking-core');

if (!admin.apps.length) admin.initializeApp();

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID');
const APP_URL = 'https://raceplan.coachkrispel.com';

exports.trackDailyReport = onSchedule({
  schedule: '0 8 * * *', timeZone: 'Asia/Jerusalem', region: 'us-central1', memory: '256MiB',
  secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
}, async () => {
  const day = dayKey(new Date(), 1);
  const snap = await admin.firestore().doc(`stats/${day}`).get();
  const text = formatReport(day, snap.exists ? snap.data() : null, APP_URL);
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN.value().trim()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID.value().trim(), text, disable_web_page_preview: true }),
  });
  // the status only: the address holds the token
  if (!r.ok) throw new Error(`telegram sendMessage failed: ${r.status}`);
});
