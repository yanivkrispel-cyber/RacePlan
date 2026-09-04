/**
 * RacePlan — Google Apps Script web app.
 *
 * Serves the single-file React app (build/build.mjs -> index.html) and
 * persists each user's athlete bank in an auto-created Google Sheet.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: "Anyone with Google account"  (per-user data by email)
 *                   or "Anyone" (all users share an anonymous browser key)
 */

var SHEET_NAME = 'athletes';
var CHUNK = 40000;          // < 50k cell-character limit, with headroom
var PROP_SS_ID = 'RP_SPREADSHEET_ID';

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

// ── Per-user identity ─────────────────────────────────────────────────
function userKey_(anonKey) {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (err) {}
  if (email) return 'e:' + email;
  anonKey = (anonKey || '').toString().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80);
  return anonKey ? 'k:' + anonKey : 'k:_shared';
}

// ── Storage (lazy-created spreadsheet) ───────────────────────────────
function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SS_ID);
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('RacePlan — athlete data');
    props.setProperty(PROP_SS_ID, ss.getId());
  }
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['key', 'chunk', 'data', 'updatedAt']);
  }
  return sh;
}

/**
 * Load the athlete-bank JSON for the calling user.
 * @param {string} anonKey  browser-generated fallback id
 * @return {string} JSON string, or '' when nothing stored yet
 */
function rp_loadAthletes(anonKey) {
  var key = userKey_(anonKey);
  var sh = sheet_();
  var values = sh.getDataRange().getValues();   // includes header
  var parts = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === key) parts.push([Number(values[i][1]) || 0, String(values[i][2] || '')]);
  }
  if (!parts.length) return '';
  parts.sort(function (a, b) { return a[0] - b[0]; });
  return parts.map(function (p) { return p[1]; }).join('');
}

/**
 * Replace the athlete-bank JSON for the calling user.
 * @param {string} anonKey  browser-generated fallback id
 * @param {string} json     full db JSON ({ athletes: [...] })
 * @return {string} 'ok'
 */
function rp_saveAthletes(anonKey, json) {
  json = (json == null) ? '' : String(json);
  // guard against runaway payloads (~5 MB)
  if (json.length > 5000000) throw new Error('payload too large');

  var key = userKey_(anonKey);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var values = sh.getDataRange().getValues();

    // delete existing rows for this key (bottom-up so indexes stay valid)
    for (var i = values.length - 1; i >= 1; i--) {
      if (values[i][0] === key) sh.deleteRow(i + 1);
    }

    var now = new Date().toISOString();
    var rows = [];
    if (json.length === 0) {
      rows.push([key, 0, '', now]);
    } else {
      for (var off = 0, idx = 0; off < json.length; off += CHUNK, idx++) {
        rows.push([key, idx, json.substr(off, CHUNK), now]);
      }
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return 'ok';
}
