/**
 * RacePlan — Google Apps Script web app (frontend).
 *
 * Serves the single-file React app (build/build.mjs -> AppJs.gs / index.html).
 *
 * Deployment (appsscript.json):
 *   Execute as:      User accessing the web app
 *   Who has access:  Anyone with a Google account   (so every visitor signs in
 *                    and the script can read their email)
 *
 * Roles:
 *   owner  — email matches RP_OWNER_EMAIL. Full app, incl. the athlete bank,
 *            stored privately in the owner's PropertiesService.getUserProperties().
 *   free   — everyone else. Personal race planning only; the athlete-bank calls
 *            are refused server-side and the UI is hidden client-side.
 *
 * Every sign-in is logged to the owner's "RacePlan — users" sheet via a
 * separate tiny web app (see logger/). The frontend just POSTs the email to it
 * from the browser.
 */

var DEFAULT_OWNER_EMAIL = 'yaniv.krispel@gmail.com';
// The usage logger (logger/ project). Override either value with a Script
// Property (RP_LOGGER_URL / RP_LOG_TOKEN) — e.g. after redeploying the logger.
var DEFAULT_LOGGER_URL = 'https://script.google.com/macros/s/AKfycbwdxoV_SJaDPhHWzpPzVtcHTGoYowgnuvUaNHEM_bSdRep6xMs4eEb7SNoMMtb0cQw1gg/exec';
var DEFAULT_LOG_TOKEN = 'rp-log-9f3a7c2e8b41';

// Convenience — run from the editor to point at a different owner/logger.
function setupConfig(loggerUrl, logToken, ownerEmail) {
  var p = PropertiesService.getScriptProperties();
  if (loggerUrl != null) p.setProperty('RP_LOGGER_URL', loggerUrl);
  if (logToken != null) p.setProperty('RP_LOG_TOKEN', logToken);
  if (ownerEmail != null) p.setProperty('RP_OWNER_EMAIL', ownerEmail);
  return p.getProperties();
}

// UserProperties: 9 KB per value, ~500 KB per user total. We chunk the JSON.
var AB_PREFIX = 'rp_ab_';   // rp_ab_n = chunk count; rp_ab_0..k = chunk data
var AB_CHUNK = 8000;
var AB_MAX = 460000;

// ── identity / role ───────────────────────────────────────────────────
function activeEmail_() {
  try { return (Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (err) { return ''; }
}
function ownerEmail_() {
  return (PropertiesService.getScriptProperties().getProperty('RP_OWNER_EMAIL')
    || DEFAULT_OWNER_EMAIL).trim().toLowerCase();
}
function isOwner_() {
  var e = activeEmail_();
  return !!e && e === ownerEmail_();
}

// ── Web app entry ──────────────────────────────────────────────────────
function doGet(e) {
  var p = (e && e.parameter) || {};

  // The client script is served here, verbatim, NOT inlined in the HTML —
  // HtmlService would sanitize tag-like substrings out of it. ContentService
  // does not sanitize. index.html loads this via <script src=".../exec?js=1">.
  if (p.js === '1') {
    return ContentService.createTextOutput(RP_APP_JS)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  var execUrl = '';
  try { execUrl = ScriptApp.getService().getUrl() || ''; } catch (err) {}

  var props = PropertiesService.getScriptProperties();
  var email = activeEmail_();

  var t = HtmlService.createTemplateFromFile('index');

  var s = p.s ? String(p.s).replace(/[^A-Za-z0-9+/=]/g, '') : '';  // base64 only
  t.shareJson = s ? JSON.stringify(s) : 'null';
  t.execUrlJson = JSON.stringify(execUrl);
  t.appJsUrl = execUrl + (execUrl.indexOf('?') === -1 ? '?' : '&') + 'js=1';
  t.userJson = JSON.stringify({ email: email, tier: isOwner_() ? 'owner' : 'free' });
  t.loggerJson = JSON.stringify({
    url: props.getProperty('RP_LOGGER_URL') || DEFAULT_LOGGER_URL,
    token: props.getProperty('RP_LOG_TOKEN') || DEFAULT_LOG_TOKEN,
  });

  return t.evaluate()
    .setTitle('RacePlan — מתכנן קצב לריצה')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Lets index.html pull in extra .html partials via <?!= include('x') ?>
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ── Per-user athlete-bank storage (owner only) ───────────────────────
/**
 * Load the calling user's athlete-bank JSON. Owner only.
 * @return {string} the JSON string, or '' when empty / not the owner
 */
function rp_loadAthletes() {
  if (!isOwner_()) return '';
  var props = PropertiesService.getUserProperties();
  var n = parseInt(props.getProperty(AB_PREFIX + 'n'), 10);
  if (!n || n < 1) return '';
  var parts = [];
  for (var i = 0; i < n; i++) parts.push(props.getProperty(AB_PREFIX + i) || '');
  return parts.join('');
}

/**
 * Replace the calling user's athlete-bank JSON. Owner only.
 * @param {string} json  full db JSON ({ athletes: [...] })
 * @return {string} 'ok' | 'denied'
 */
function rp_saveAthletes(json) {
  if (!isOwner_()) return 'denied';
  json = (json == null) ? '' : String(json);
  if (json.length > AB_MAX) throw new Error('athlete bank too large for the per-user store');

  var lock = LockService.getUserLock();
  lock.waitLock(15000);
  try {
    var props = PropertiesService.getUserProperties();
    var prev = parseInt(props.getProperty(AB_PREFIX + 'n'), 10) || 0;
    var chunks = json ? Math.ceil(json.length / AB_CHUNK) : 0;

    var write = {};
    for (var i = 0; i < chunks; i++) write[AB_PREFIX + i] = json.substr(i * AB_CHUNK, AB_CHUNK);
    write[AB_PREFIX + 'n'] = String(chunks);
    props.setProperties(write, false);

    for (var j = chunks; j < prev; j++) props.deleteProperty(AB_PREFIX + j);
    if (chunks === 0) props.deleteProperty(AB_PREFIX + 'n');
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}
