/**
 * RacePlan — usage logger (separate tiny web app).
 *
 * Deployment (logger/appsscript.json):
 *   Execute as:      Me (the owner)      -> writes land in the OWNER's Drive
 *   Who has access:  Anyone (even anonymous)
 *
 * The RacePlan frontend POSTs {email, token} here from the browser on each
 * sign-in. We upsert one row per email into a "RacePlan — users" spreadsheet
 * in the owner's Drive: email | firstSeen | lastSeen | count. That sheet is
 * the owner's customer list; nobody else can read it.
 *
 * The shared token below just deters drive-by bots from POSTing junk into the
 * customer sheet; it's also visible in the frontend page source, so it's not a
 * real secret. Override it privately with setToken('…') from the editor and set
 * the same value as RP_LOG_TOKEN on the frontend if you want.
 */

var SHEET_TAB = 'users';
var SS_PROP = 'RP_LOG_SS_ID';
var TOKEN_PROP = 'RP_LOG_TOKEN';
var DEFAULT_TOKEN = 'rp-log-9f3a7c2e8b41';

function setToken(token) {
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROP, String(token || ''));
  return 'ok';
}

function doGet() {
  return ContentService.createTextOutput('RacePlan logger — POST only');
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}

  var wantToken = PropertiesService.getScriptProperties().getProperty(TOKEN_PROP) || DEFAULT_TOKEN;
  if (String(body.token || '') !== wantToken) {
    return ContentService.createTextOutput('denied');
  }

  var email = String(body.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 1 || email.length > 254) {
    return ContentService.createTextOutput('bad');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheet_();
    var vals = sh.getDataRange().getValues();   // [header, ...rows]
    var now = new Date();
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim().toLowerCase() === email) {
        sh.getRange(i + 1, 3).setValue(now);                        // lastSeen
        sh.getRange(i + 1, 4).setValue((Number(vals[i][3]) || 0) + 1); // count
        return ContentService.createTextOutput('seen');
      }
    }
    sh.appendRow([email, now, now, 1]);
    return ContentService.createTextOutput('new');
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SS_PROP), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('RacePlan — users');
    props.setProperty(SS_PROP, ss.getId());
  }
  var sh = ss.getSheetByName(SHEET_TAB);
  if (!sh) {
    sh = ss.getSheets()[0].setName(SHEET_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['email', 'firstSeen', 'lastSeen', 'count']]);
    sh.setFrozenRows(1);
  }
  return sh;
}
