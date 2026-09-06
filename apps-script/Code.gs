/**
 * RacePlan — Google Apps Script web app.
 *
 * Serves the single-file React app (build/build.mjs -> AppJs.gs / index.html)
 * and persists each user's athlete bank privately.
 *
 * Deployment (see appsscript.json):
 *   Execute as:      User accessing the web app
 *   Who has access:  Anyone with a Google account
 *
 * Because the script runs AS the visitor, PropertiesService.getUserProperties()
 * is automatically scoped to that visitor — every user gets a private store the
 * owner cannot see, synced across their devices by their Google identity. Each
 * user authorizes the script once (the "unverified app" consent screen).
 */

// UserProperties: 9 KB per value, ~500 KB per user total. We chunk the JSON.
var AB_PREFIX = 'rp_ab_';   // rp_ab_n = chunk count; rp_ab_0..k = chunk data
var AB_CHUNK = 8000;
var AB_MAX = 460000;        // refuse payloads that won't fit the per-user quota

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

  var t = HtmlService.createTemplateFromFile('index');

  var s = p.s ? String(p.s).replace(/[^A-Za-z0-9+/=]/g, '') : '';  // base64 only
  t.shareJson = s ? JSON.stringify(s) : 'null';
  t.execUrlJson = JSON.stringify(execUrl);
  t.appJsUrl = execUrl + (execUrl.indexOf('?') === -1 ? '?' : '&') + 'js=1';

  return t.evaluate()
    .setTitle('RacePlan — מתכנן קצב לריצה')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Lets index.html pull in extra .html partials via <?!= include('x') ?>
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ── Per-user athlete-bank storage ────────────────────────────────────
/**
 * Load the calling user's athlete-bank JSON.
 * @return {string} the JSON string, or '' when nothing is stored yet
 */
function rp_loadAthletes() {
  var props = PropertiesService.getUserProperties();
  var n = parseInt(props.getProperty(AB_PREFIX + 'n'), 10);
  if (!n || n < 1) return '';
  var parts = [];
  for (var i = 0; i < n; i++) parts.push(props.getProperty(AB_PREFIX + i) || '');
  return parts.join('');
}

/**
 * Replace the calling user's athlete-bank JSON.
 * @param {string} json  full db JSON ({ athletes: [...] })
 * @return {string} 'ok'
 */
function rp_saveAthletes(json) {
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
    props.setProperties(write, false);            // false: keep unrelated keys

    for (var j = chunks; j < prev; j++) props.deleteProperty(AB_PREFIX + j);
    if (chunks === 0) props.deleteProperty(AB_PREFIX + 'n');
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}
