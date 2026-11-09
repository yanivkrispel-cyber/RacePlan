// Anonymous funnel counters: the pure part (validation, day keys, the morning message). No names, no
// identifiers, no IP: one event only adds 1 to a counter of stats/{YYYY-MM-DD}. test/tracking.test.mjs.
const STEPS = ['land', 'inapp', 'inapp_tap', 'hop', 'signin_tap', 'signup', 'install', 'active', 'planner', 'plan_saved', 'watch'];
const SOURCES = ['instagram', 'facebook', 'tiktok', 'whatsapp', 'telegram', 'google', 'share', 'direct', 'other'];
const DEVICES = ['ios', 'android', 'desktop'];
const PING = 'ping'; // health check: written to stats/_ping, never to a day
const MAX_BODY = 300;
const TZ = 'Asia/Jerusalem';

/** The request body -> { step, src, dev }, or null when it is not one of ours. */
function parseEvent(body) {
  let o = body;
  if (typeof o === 'string') {
    if (o.length > MAX_BODY) return null;
    try { o = JSON.parse(o); } catch (e) { return null; }
  }
  if (!o || typeof o !== 'object') return null;
  const { step, src, dev } = o;
  if (step !== PING && !STEPS.includes(step)) return null;
  if (!SOURCES.includes(src) || !DEVICES.includes(dev)) return null;
  return { step, src, dev };
}

/** YYYY-MM-DD in Israel, `ago` days back. */
function dayKey(now = new Date(), ago = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(now.getTime() - ago * 86400000));
}

function docId(ev, now) { return ev.step === PING ? '_ping' : dayKey(now); }

/** The merge patch of one event; `inc` is FieldValue.increment(1). */
function statsPatch(ev, inc) {
  return { s: { [ev.step]: { [ev.src]: inc } }, d: { [ev.step]: { [ev.dev]: inc } } };
}

function total(doc, step) {
  const m = (doc && doc.s && doc.s[step]) || {};
  return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** The morning Telegram message for one day (Hebrew: it goes to Kris alone). */
function formatReport(day, doc, appUrl) {
  const [, m, d] = day.split('-').map(Number);
  const n = (step) => total(doc, step);
  const ig = (doc && doc.s && doc.s.land && Number(doc.s.land.instagram)) || 0;
  return [
    `RacePlan, אתמול ${d}.${m}`,
    '',
    `נכנסו: ${n('land')}, מתוכם מאינסטגרם: ${ig}`,
    `ראו "פתח בדפדפן": ${n('inapp')}`,
    `הקישו לפתיחה: ${n('inapp_tap')}`,
    `הגיעו לדפדפן: ${n('hop')}`,
    `הקישו על התחברות: ${n('signin_tap')}`,
    `נרשמו: ${n('signup')}`,
    `הוסיפו למסך הבית: ${n('install')}`,
    '',
    `פתחו מחוברים: ${n('active')}`,
    `נכנסו לתכנון: ${n('planner')}`,
    `שמרו תכנית: ${n('plan_saved')}`,
    `שלחו לשעון: ${n('watch')}`,
    '',
    `${appUrl}/?stats=1`,
  ].join('\n');
}

// The owner's list of sign-ups: only this account may ask, and only with a verified email.
const OWNER_EMAIL = 'yaniv.krispel@gmail.com';
const isOwnerToken = (token) => !!token && token.email_verified === true
  && String(token.email || '').toLowerCase() === OWNER_EMAIL;

// users/{uid}/plans/data holds { json: '{"plans":[...]}' }: the owner's list gets the number, never the plans.
function countPlans(json) {
  try {
    const db = JSON.parse(json);
    return Array.isArray(db && db.plans) ? db.plans.length : 0;
  } catch (e) { return 0; }
}

module.exports = { STEPS, SOURCES, DEVICES, PING, MAX_BODY, parseEvent, dayKey, docId, statsPatch, total, formatReport, isOwnerToken, countPlans };
