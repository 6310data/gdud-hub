/**
 * לוגיסטיקה גדודית – Apps Script web app (v2.6)
 * -------------------------------------------------
 *   'טבלת צ'          – every serial (קטגוריה / פריט / צ / סטטוס)
 *   'גדודי'           – sign-out table (שם מלא, פריט, צ, הערות, ציוד משלים; פלוגה/מחלקה/מס' אישי are VLOOKUPs)
 *   'אלפון גדודי'     – people (שם מלא, מספר אישי, שם פרטי, שם משפחה, פלוגה, מחלקה, מספר טלפון)
 *   'Dropdowns'       – companies (col A) + item catalogue (C–F)
 *   'תקן ציוד משלים'  – accessory kit per item: פריט צ | שם פריט | כמות
 *   'לוג'             – created by the script
 *
 * Status values in 'טבלת צ':  חתום | נשקייה תקין | נשקייה תקול | נשקייה חטיבה
 *   - 'גדודי' stays the source of truth for WHO holds a serial; the app keeps the status column in sync
 *     (sign-out → חתום, return → the chosen destination). Empty status is treated as נשקייה תקין.
 *   - Only נשקייה תקין serials can be signed out.
 *
 * v2.2 – ACCESS BY SHEET PERMISSIONS (default, AUTH_MODE = 'sheet'):
 *   the signed-in Google account is checked against the spreadsheet's sharing:
 *     can edit the sheet            → admin
 *     can view / comment the sheet  → viewer ('user')
 *     no access                     → blocked
 *   Deploy → Web app → Execute as: **User accessing the web app**, Who has access: **Anyone with a Google account**.
 *   (Running as the user is what lets Apps Script see the email of a gmail.com account, and it also means
 *   Google itself blocks writes by viewers.) The old code login is still available: setConfig({authMode:'codes'}).
 *
 * v2.4 – FORMULA COLUMNS ARE NEVER WRITTEN:
 *   'גדודי' A/B/D (פלוגה, מחלקה, מס' אישי) and 'אלפון גדודי' A (שם מלא) hold formulas.
 *   Every write to those two sheets goes through writeCells_(), which throws if a value would land in one of
 *   those columns. New rows get the formula copied from the row above (never a value); ARRAYFORMULA is left alone.
 *   Run checkFormulaColumns() from the editor to list rows where a formula was already replaced by a value.
 *
 * v2.5 – SAFETY NET: every write operation (withLock_) snapshots which rows of the formula columns hold a
 *   formula before it runs and checks again after. If a formula disappeared – whatever the cause – it is put
 *   back immediately and the event is written to 'לוג' as 'תיקון נוסחה אוטומטי' (with the operation name).
 *   Row deletes never remove an ARRAYFORMULA anchor (the row is cleared instead).
 *
 * v2.6 – אפסון: sheet 'אפסון' = פלוגה | שם מלא | מספר אישי | פריט | צ | תאריך אפסון | תאריך הוצאה מאפסון.
 *   A row with an empty G is currently in storage. storeItems() appends rows, releaseItems() fills G (history kept).
 *   Storing does not change 'גדודי' or the serial status – the item stays signed on the soldier.
 *   Returning (זיכוי) or transferring a stored serial closes its storage row automatically.
 *
 * Setup: edit setupCodes() → Run once.
 */

var SHEETS = {
  SERIALS: 'טבלת צ',
  ASSIGN: 'גדודי',
  PEOPLE: 'אלפון גדודי',
  DROPDOWNS: 'Dropdowns',
  KIT: 'תקן ציוד משלים',
  LOG: 'לוג',
  STORAGE: 'אפסון'
};

var STATUS = { SIGNED: 'חתום', OK: 'נשקייה תקין', BROKEN: 'נשקייה תקול', BRIGADE: 'נשקייה חטיבה' };
var STATUS_LIST = [STATUS.OK, STATUS.BROKEN, STATUS.BRIGADE];

// 'גדודי' columns (1-based)
var A_COL = { COMPANY: 1, UNIT: 2, NAME: 3, PID: 4, ITEM: 5, SERIAL: 6, NOTES: 7, KIT: 8 };
var ASSIGN_HEADER_ROWS = 1;
var KIT_HEADER = 'ציוד משלים';

// 'טבלת צ' columns
var S_COL = { CAT: 1, ITEM: 2, SERIAL: 3, STATUS: 4 };

// 'אפסון' columns
var ST_COL = { COMPANY: 1, NAME: 2, PID: 3, ITEM: 4, SERIAL: 5, IN: 6, OUT: 7 };
var STORAGE_HEADER_ROWS = 1;
var STORAGE_HEADERS = ['פלוגה', 'שם מלא', 'מספר אישי', 'פריט', 'צ', 'תאריך אפסון', 'תאריך הוצאה מאפסון'];

// 'אלפון גדודי' columns
var P_COL = { NAME: 1, PID: 2, FIRST: 3, LAST: 4, COMPANY: 5, UNIT: 6, PHONE: 7 };
var PEOPLE_HEADER_ROWS = 1;

// Formula columns – the app must NEVER write a value into these (see writeCells_).
var A_FORMULA_COLS = [A_COL.COMPANY, A_COL.UNIT, A_COL.PID];   // 'גדודי'  A, B, D
var P_FORMULA_COLS = [P_COL.NAME];                              // 'אלפון גדודי'  A

var DEFAULT_CODES = { user: '<user-code>', admin: '<admin-code>' };   // real codes removed from the reference copy
var PDF_FOLDER_NAME = 'טפסי החתמה – גדוד';
var APP_VERSION = '2.6';

// ---------------------------------------------------------------- setup ----

/**
 * SETUP: edit the values, pick this function in the editor and press Run (once).
 *   userCode / adminCode – access codes
 *   pdfFolderId          – Drive folder ID for sign-out PDFs ('' = create a folder next to the spreadsheet)
 *   pdfSharing           – 'anyone' = anyone with the link can open the PDF (needed for soldiers without Google access)
 *                          'private' = only people with access to the folder
 */
function setupCodes() {
  return setConfig({ authMode: 'codes', userCode: '<user-code>', adminCode: '<admin-code>', pdfFolderId: '' /* removed from the reference copy */, pdfSharing: 'anyone' });
}

/** Shows how the current account (you, in the editor) is resolved. Handy after changing sharing. */
function testAccess() {
  var r = login('', true);
  r.version = APP_VERSION;
  Logger.log(JSON.stringify(r));
  return r;
}

function setConfig(cfg) {
  var p = PropertiesService.getScriptProperties();
  if (cfg.userCode) p.setProperty('USER_CODE', String(cfg.userCode));
  if (cfg.adminCode) p.setProperty('ADMIN_CODE', String(cfg.adminCode));
  if (cfg.pdfFolderId !== undefined) p.setProperty('PDF_FOLDER_ID', String(cfg.pdfFolderId || ''));
  if (cfg.pdfSharing) p.setProperty('PDF_SHARING', String(cfg.pdfSharing));
  if (cfg.authMode) {
    if (['sheet', 'codes'].indexOf(cfg.authMode) < 0) throw new Error("authMode must be 'sheet' or 'codes'");
    p.setProperty('AUTH_MODE', cfg.authMode);
  }
  return { authMode: authMode_(), codes: getCodes_(), pdfFolderId: p.getProperty('PDF_FOLDER_ID') || '(auto)', pdfSharing: p.getProperty('PDF_SHARING') || 'anyone' };
}
function setCodes(userCode, adminCode) { return setConfig({ userCode: userCode, adminCode: adminCode }); }

/**
 * AUTHORIZE DRIVE + TEST PDF: pick this function in the editor and press Run.
 * The first run pops the Google consent screen for Drive – accept it. Then it writes a test PDF
 * to the configured folder and logs its URL (View → Logs / Execution log).
 * If the web app says "Google Drive access denied", this is the fix: the deployment runs with the
 * owner's authorization, and that authorization must include Drive. After running, redeploy
 * (Deploy → Manage deployments → ✎ → New version).
 */
function testPdf() {
  var folder = pdfFolder_();
  var d = formData_('בדיקה', [{ item: 'פריט לדוגמה', serial: '0000', kit: [{ name: 'אביזר', qty: 2 }] }], 'קובץ בדיקה – אפשר למחוק', 'admin', 'בדיקת מערכת');
  var pdf = createSignOutPdf_(d);
  Logger.log('תיקייה: ' + folder.getName() + ' (' + folder.getId() + ')');
  Logger.log('PDF: ' + pdf.url);
  return pdf;
}

function getCodes_() {
  var p = PropertiesService.getScriptProperties();
  return { user: p.getProperty('USER_CODE') || DEFAULT_CODES.user, admin: p.getProperty('ADMIN_CODE') || DEFAULT_CODES.admin };
}

// ----------------------------------------------------------------- web -----

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('לוגיסטיקה גדודית')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------- auth -----
//
// Two modes (Script Property AUTH_MODE):
//   'sheet' (default) – role comes from the spreadsheet's Google sharing. The `code` argument that the
//                       client still passes is ignored.
//   'codes'           – the v2.1 behaviour: user code / admin code.

var ROLE_CACHE_SECONDS = 300;           // permission changes take effect within 5 minutes (or on "בדיקת הרשאות")
var ACTOR_ = { email: '', role: '' };   // who is running the current request – used by the log

function authMode_() {
  return PropertiesService.getScriptProperties().getProperty('AUTH_MODE') || 'sheet';
}

function roleForCode_(code) {
  var codes = getCodes_();
  code = String(code || '').trim();
  if (!code) return null;
  if (code === codes.admin) return 'admin';
  if (code === codes.user) return 'user';
  return null;
}

function activeEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}

/**
 * Resolve the signed-in user's role from the spreadsheet sharing.
 * Returns { email, role: 'admin'|'user'|null, error }
 */
function sheetRole_(force) {
  var email = activeEmail_();
  if (!email) {
    return { email: '', role: null, error: 'לא ניתן לזהות את חשבון Google. יש לפרוס את האפליקציה כ-"Execute as: User accessing the web app" ולהיכנס עם חשבון Google.' };
  }
  var cache = CacheService.getScriptCache(), key = 'role_' + email;
  if (!force) {
    var hit = cache.get(key);
    if (hit) return { email: email, role: hit === '-' ? null : hit, error: hit === '-' ? noAccessMsg_(email) : '' };
  }
  var role = null, id = ss_().getId();
  var effective = '';
  try { effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { }

  if (effective === email) {
    // Script runs as the visitor → ask Drive what THIS user can do with the file.
    // Covers direct shares, Google Groups, domain and "anyone with the link" access.
    var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=capabilities(canEdit)&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    var codeHttp = res.getResponseCode(), body = res.getContentText();
    if (codeHttp === 200) {
      var caps = (JSON.parse(body).capabilities) || {};
      role = caps.canEdit ? 'admin' : 'user';
    } else if (codeHttp === 404 || (codeHttp === 403 && !/accessNotConfigured|SERVICE_DISABLED|insufficient/i.test(body))) {
      role = null;                                   // the file isn't visible to this user
    } else {
      role = driveAppRole_(id, email);               // Drive REST unavailable → DriveApp fallback
    }
  } else {
    // Script runs as the owner (same Workspace domain only) → compare against the sharing lists.
    // Note: in this mode Google Groups / link sharing are NOT recognised – only people listed by email.
    var file = DriveApp.getFileById(id);
    var has = function (list) { return list.some(function (u) { return String(u.getEmail()).toLowerCase() === email; }); };
    var owner = file.getOwner();
    if ((owner && String(owner.getEmail()).toLowerCase() === email) || has(file.getEditors())) role = 'admin';
    else if (has(file.getViewers())) role = 'user';
  }
  cache.put(key, role || '-', ROLE_CACHE_SECONDS);
  return { email: email, role: role, error: role ? '' : noAccessMsg_(email) };
}
/**
 * Fallback when the Drive REST API can't be called (e.g. disabled in a linked Cloud project).
 * Less complete: access granted only through a Google Group is seen as view-only.
 */
function driveAppRole_(id, email) {
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { return null; }   // can't open → no access
  try {
    var P = DriveApp.Permission;
    var mine = file.getAccess(email);
    if (mine === P.OWNER || mine === P.EDIT || (file.getSharingAccess() !== DriveApp.Access.PRIVATE && file.getSharingPermission() === P.EDIT)) return 'admin';
  } catch (e) { }
  return 'user';
}
function noAccessMsg_(email) {
  return 'אין הרשאה: לחשבון \u2066' + email + '\u2069 אין גישה לגיליון. יש לבקש מבעל הגיליון לשתף אותו (צפייה = צופה, עריכה = מנהל).';
}

function requireRole_(code, needAdmin) {
  var role, email = '';
  if (authMode_() === 'codes') {
    role = roleForCode_(code);
    if (!role) throw new Error('קוד גישה שגוי');
  } else {
    var r = sheetRole_(false);
    if (!r.role) throw new Error(r.error);
    role = r.role; email = r.email;
  }
  ACTOR_ = { email: email, role: role };
  if (needAdmin && role !== 'admin') throw new Error('פעולה זו מותרת למנהל בלבד (נדרשת הרשאת עריכה בגיליון)');
  return role;
}

/** Editing an existing soldier: open to viewers only in 'codes' mode (in 'sheet' mode a viewer can't write). */
function viewerCanEditPeople_() { return authMode_() === 'codes'; }

/**
 * Client entry point. In 'sheet' mode `code` is ignored; `force` skips the 5-minute role cache.
 * Returns { ok, mode, role, email, viewerCanEditPeople, error }
 */
function login(code, force) {
  var mode = authMode_();
  if (mode === 'codes') {
    var role = roleForCode_(code);
    if (!role) return { ok: false, mode: mode, error: code ? 'קוד גישה שגוי' : '' };
    return { ok: true, mode: mode, role: role, email: '', viewerCanEditPeople: true };
  }
  var r = sheetRole_(!!force);
  if (!r.role) return { ok: false, mode: mode, email: r.email, error: r.error };
  return { ok: true, mode: mode, role: r.role, email: r.email, viewerCanEditPeople: false };
}

function actorLabel_(role) {
  var r = role || ACTOR_.role;
  return ACTOR_.email ? (r === 'admin' ? 'מנהל' : 'צופה') + ' · ' + ACTOR_.email : r;
}

// ------------------------------------------------------------- helpers -----

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('הדף "' + name + '" לא נמצא בטבלה');
  return sh;
}
function s_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function normSerial_(v) {
  var t = s_(v).replace(/[\s\-]/g, '');
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  return t;
}
function normStatus_(v) { v = s_(v); return v === '' ? STATUS.OK : v; }
function withLock_(fn, opName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var before = formulaState_();
    try { return fn(); }
    finally { healFormulas_(before, opName); }
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------- formula safety net -----

/** Identity of a data row that survives row deletes/shifts: 'גדודי' → serial (F), 'אלפון' → B|C|D. */
function rowKey_(sheetName, r) {
  return sheetName === SHEETS.ASSIGN ? normSerial_(r[A_COL.SERIAL - 1]) + '|' + s_(r[A_COL.NAME - 1])
                                     : s_(r[P_COL.PID - 1]) + '|' + s_(r[P_COL.FIRST - 1]) + '|' + s_(r[P_COL.LAST - 1]);
}
/**
 * For both sheets: { sheetName: { cols: {col: 'array'|'rows'}, missing: {col+'#'+key: true}, anchors: {col: formula} } }
 * `missing` = data rows whose formula cell has no formula.
 */
function formulaState_() {
  var st = {};
  [[SHEETS.ASSIGN, ASSIGN_HEADER_ROWS, lastAssignRow_], [SHEETS.PEOPLE, PEOPLE_HEADER_ROWS, lastPeopleRow_]].forEach(function (d) {
    var sh = ss_().getSheetByName(d[0]); if (!sh) return;
    var hdr = d[1], last = d[2](sh), info = { cols: {}, missing: {}, anchors: {} };
    st[d[0]] = info;
    if (last <= hdr) return;
    var n = last - hdr, vals = sh.getRange(hdr + 1, 1, n, 8).getValues();
    formulaCols_(sh).forEach(function (c) {
      var f = sh.getRange(hdr + 1, c, n, 1).getFormulasR1C1();
      if (/ARRAYFORMULA/i.test(f[0][0])) { info.cols[c] = 'array'; info.anchors[c] = f[0][0]; return; }
      info.cols[c] = 'rows';
      info.tpl = info.tpl || {}; info.tpl[c] = commonFormula_(f);
      for (var i = 0; i < n; i++) if (!f[i][0]) info.missing[c + '#' + rowKey_(d[0], vals[i])] = true;
    });
  });
  return st;
}
/** Compare with the state before the operation and put back any formula that went missing. */
function healFormulas_(before, opName) {
  try {
    var fixed = [];
    [[SHEETS.ASSIGN, ASSIGN_HEADER_ROWS, lastAssignRow_], [SHEETS.PEOPLE, PEOPLE_HEADER_ROWS, lastPeopleRow_]].forEach(function (d) {
      var b = before[d[0]], sh = ss_().getSheetByName(d[0]); if (!b || !sh) return;
      var hdr = d[1], last = d[2](sh); if (last <= hdr) return;
      var n = last - hdr, vals = sh.getRange(hdr + 1, 1, n, 8).getValues();
      Object.keys(b.cols).forEach(function (cs) {
        var c = +cs, rng = sh.getRange(hdr + 1, c, n, 1), f = rng.getFormulasR1C1();
        if (b.cols[c] === 'array') {
          if (!f[0][0]) { sh.getRange(hdr + 1, c).setFormulaR1C1(b.anchors[c]); fixed.push(d[0] + ' ' + colLetter_(c) + (hdr + 1) + ' (ARRAYFORMULA)'); }
          return;
        }
        var tpl = commonFormula_(f) || (b.tpl && b.tpl[c]); if (!tpl) return;
        for (var i = 0; i < n; i++) {
          if (f[i][0]) continue;
          if (b.missing[c + '#' + rowKey_(d[0], vals[i])]) continue;      // was already like that – not ours
          var v = s_(sh.getRange(hdr + 1 + i, c).getDisplayValue());
          sh.getRange(hdr + 1 + i, c).setFormulaR1C1(tpl);
          fixed.push(d[0] + ' ' + colLetter_(c) + (hdr + 1 + i) + (v ? ' (היה: ' + v + ')' : ''));
        }
      });
    });
    if (fixed.length) {
      SpreadsheetApp.flush();
      logSheet_().appendRow([new Date(), 'מערכת', 'תיקון נוסחה אוטומטי', '', '', '', 'אחרי ' + (opName || '?') + ': ' + fixed.join(', '), '']);
      console.warn('healFormulas_ after ' + opName + ': ' + fixed.join(', '));
    }
  } catch (e) { console.error('healFormulas_ failed: ' + e); }
}
function commonFormula_(f) {
  var count = {}, tpl = '', best = 0;
  f.forEach(function (r) { if (r[0] && !/ARRAYFORMULA/i.test(r[0])) { count[r[0]] = (count[r[0]] || 0) + 1; if (count[r[0]] > best) { best = count[r[0]]; tpl = r[0]; } } });
  return tpl;
}
/**
 * Delete a data row from 'גדודי' / 'אלפון גדודי'. If the row is the anchor of an ARRAYFORMULA in a formula
 * column, deleting it would delete the formula – so only the non-formula cells are cleared instead.
 */
function deleteDataRow_(sh, row) {
  var prot = formulaCols_(sh);
  var anchor = prot.some(function (c) { return /ARRAYFORMULA/i.test(sh.getRange(row, c).getFormula()); });
  if (!anchor) { sh.deleteRow(row); return; }
  for (var c = 1; c <= 8; c++) if (prot.indexOf(c) < 0) sh.getRange(row, c).clearContent();
}

/** Last row in 'גדודי' holding data (ignores formula-only rows). */
function lastAssignRow_(sh) {
  var last = sh.getLastRow();
  if (last <= ASSIGN_HEADER_ROWS) return ASSIGN_HEADER_ROWS;
  var vals = sh.getRange(ASSIGN_HEADER_ROWS + 1, A_COL.NAME, last - ASSIGN_HEADER_ROWS, A_COL.SERIAL - A_COL.NAME + 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    var r = vals[i];
    if (s_(r[0]) || s_(r[A_COL.ITEM - A_COL.NAME]) || s_(r[A_COL.SERIAL - A_COL.NAME])) return ASSIGN_HEADER_ROWS + 1 + i;
  }
  return ASSIGN_HEADER_ROWS;
}
// ------------------------------------------------------ formula guard -----

function colLetter_(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }
function formulaCols_(sh) {
  var n = sh.getName();
  return n === SHEETS.ASSIGN ? A_FORMULA_COLS : n === SHEETS.PEOPLE ? P_FORMULA_COLS : [];
}
/**
 * The ONLY way the app writes values to 'גדודי' / 'אלפון גדודי'.
 * values = 1-D array written to (row, col … col+len-1). Throws before writing anything
 * if the range touches a formula column.
 */
function writeCells_(sh, row, col, values) {
  var prot = formulaCols_(sh);
  for (var c = col; c < col + values.length; c++) {
    if (prot.indexOf(c) >= 0) throw new Error('שגיאה פנימית: ניסיון לכתוב ערך לעמודת נוסחה ' + colLetter_(c) + ' בדף ' + sh.getName() + ' – הפעולה בוטלה');
  }
  sh.getRange(row, col, 1, values.length).setValues([values]);
}
/**
 * Make sure each formula column of `row` holds a formula, copied (R1C1, so references shift) from the
 * nearest row above that has one. Never writes a value. Skips ARRAYFORMULA (it already fills the row).
 */
function fillFormulas_(sh, row, headerRows) {
  formulaCols_(sh).forEach(function (c) {
    var cell = sh.getRange(row, c);
    if (cell.getFormula()) return;
    if (s_(cell.getValue())) return;   // value spilled from an ARRAYFORMULA (or legacy value) – don't touch
    if (row - 1 <= headerRows) return;
    var above = sh.getRange(headerRows + 1, c, row - 1 - headerRows, 1).getFormulasR1C1();
    if (/ARRAYFORMULA/i.test(above[0][0])) return;
    for (var i = above.length - 1; i >= 0; i--) {
      var f = above[i][0];
      if (!f) continue;
      if (/ARRAYFORMULA/i.test(f)) return;
      cell.setFormulaR1C1(f);
      return;
    }
  });
}
function ensureLookupFormulas_(sh, row) { fillFormulas_(sh, row, ASSIGN_HEADER_ROWS); }

/** Last row in 'אלפון גדודי' with real data in B–G (column A is a formula and may run past the data). */
function lastPeopleRow_(sh) {
  var last = sh.getLastRow();
  if (last <= PEOPLE_HEADER_ROWS) return PEOPLE_HEADER_ROWS;
  var vals = sh.getRange(PEOPLE_HEADER_ROWS + 1, P_COL.PID, last - PEOPLE_HEADER_ROWS, P_COL.PHONE - P_COL.PID + 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (vals[i].some(function (v) { return s_(v); })) return PEOPLE_HEADER_ROWS + 1 + i;
  return PEOPLE_HEADER_ROWS;
}

/**
 * EDITOR: pick this function → Run. Lists rows where a formula column holds a plain value instead of a formula
 * (that is what breaks the VLOOKUPs). Read-only – nothing is changed.
 */
function checkFormulaColumns() {
  var out = [];
  [[SHEETS.ASSIGN, ASSIGN_HEADER_ROWS, lastAssignRow_], [SHEETS.PEOPLE, PEOPLE_HEADER_ROWS, lastPeopleRow_]].forEach(function (d) {
    var sh = sheet_(d[0]), last = d[2](sh), hdr = d[1];
    if (last <= hdr) return;
    var arr = {};
    formulaCols_(sh).forEach(function (c) {
      var top = sh.getRange(hdr + 1, c).getFormula();
      if (/ARRAYFORMULA/i.test(top)) { arr[c] = true; return; }
      var f = sh.getRange(hdr + 1, c, last - hdr, 1).getFormulas(), v = sh.getRange(hdr + 1, c, last - hdr, 1).getDisplayValues();
      var bad = [];
      for (var i = 0; i < f.length; i++) if (!f[i][0] && s_(v[i][0])) bad.push(hdr + 1 + i);
      out.push(d[0] + ' עמודה ' + colLetter_(c) + ': ' + (bad.length ? bad.length + ' שורות עם ערך במקום נוסחה – ' + bad.slice(0, 50).join(', ') + (bad.length > 50 ? ' …' : '') : 'תקין'));
    });
    Object.keys(arr).forEach(function (c) { out.push(d[0] + ' עמודה ' + colLetter_(+c) + ': ARRAYFORMULA – תקין'); });
  });
  Logger.log(out.join('\n'));
  return out;
}
/** Make sure 'גדודי' has the 'ציוד משלים' header in column H. */
function ensureKitColumn_(sh) {
  var h = s_(sh.getRange(1, A_COL.KIT).getValue());
  if (!h) writeCells_(sh, 1, A_COL.KIT, [KIT_HEADER]);
}

/** Map serial → {row, status, item, cat} from 'טבלת צ'. */
function serialIndex_(shS) {
  var idx = {};
  if (shS.getLastRow() > 1) {
    shS.getRange(2, 1, shS.getLastRow() - 1, 4).getValues().forEach(function (r, i) {
      var k = normSerial_(r[S_COL.SERIAL - 1]);
      if (k && !idx[k]) idx[k] = { row: i + 2, cat: s_(r[0]), item: s_(r[1]), status: normStatus_(r[3]) };
    });
  }
  return idx;
}
/** Map serial → {row, name, item} from 'גדודי'. */
function assignIndex_(shA) {
  var idx = {}, lastA = lastAssignRow_(shA);
  if (lastA > ASSIGN_HEADER_ROWS) {
    shA.getRange(ASSIGN_HEADER_ROWS + 1, A_COL.NAME, lastA - ASSIGN_HEADER_ROWS, A_COL.SERIAL - A_COL.NAME + 1).getDisplayValues().forEach(function (r, i) {
      var k = normSerial_(r[A_COL.SERIAL - A_COL.NAME]);
      if (k) idx[k] = { row: ASSIGN_HEADER_ROWS + 1 + i, name: s_(r[0]), item: s_(r[A_COL.ITEM - A_COL.NAME]) };
    });
  }
  return idx;
}
function setSerialStatus_(shS, sIdx, serial, status) {
  var s = sIdx[serial];
  if (s && s.status !== status) { shS.getRange(s.row, S_COL.STATUS).setValue(status); s.status = status; }
}

function logSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(SHEETS.LOG);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.LOG);
    sh.appendRow(['תאריך', 'תפקיד', 'פעולה', 'שם מלא', 'פריט', 'צ', 'הערות', 'קישור']);
    sh.setFrozenRows(1); sh.setRightToLeft(true);
  } else if (!s_(sh.getRange(1, 8).getValue())) sh.getRange(1, 8).setValue('קישור');
  return sh;
}
/** Read-only access to the log (viewers can't create/repair the sheet). */
function logSheetRead_() { return ss_().getSheetByName(SHEETS.LOG); }
function log_(role, action, name, item, serial, notes, link) {
  logSheet_().appendRow([new Date(), actorLabel_(role), action, s_(name), s_(item), s_(serial), s_(notes), s_(link)]);
}

// ------------------------------------------------------------ snapshot -----

function getSnapshot(code) {
  var role = requireRole_(code, false);

  var shS = sheet_(SHEETS.SERIALS), serials = [];
  if (shS.getLastRow() > 1) {
    shS.getRange(2, 1, shS.getLastRow() - 1, 4).getValues().forEach(function (r, i) {
      var serial = normSerial_(r[2]);
      if (!serial && !s_(r[1])) return;
      serials.push({ row: i + 2, cat: s_(r[0]), item: s_(r[1]), serial: serial, status: normStatus_(r[3]) });
    });
  }

  var shA = sheet_(SHEETS.ASSIGN), assignments = [], lastA = lastAssignRow_(shA);
  if (lastA > ASSIGN_HEADER_ROWS) {
    shA.getRange(ASSIGN_HEADER_ROWS + 1, 1, lastA - ASSIGN_HEADER_ROWS, A_COL.KIT).getDisplayValues().forEach(function (r, i) {
      var name = s_(r[A_COL.NAME - 1]), item = s_(r[A_COL.ITEM - 1]), serial = normSerial_(r[A_COL.SERIAL - 1]);
      if (!name && !item && !serial) return;
      assignments.push({
        row: ASSIGN_HEADER_ROWS + 1 + i,
        company: s_(r[A_COL.COMPANY - 1]).replace(/^#N\/A$/, ''),
        unit: s_(r[A_COL.UNIT - 1]).replace(/^#N\/A$/, ''),
        name: name, pid: s_(r[A_COL.PID - 1]).replace(/^#N\/A$/, ''),
        item: item, serial: serial, notes: s_(r[A_COL.NOTES - 1]), kit: s_(r[A_COL.KIT - 1])
      });
    });
  }

  var shP = sheet_(SHEETS.PEOPLE), people = [];
  if (shP.getLastRow() > 1) {
    shP.getRange(2, 1, shP.getLastRow() - 1, 7).getDisplayValues().forEach(function (r, i) {
      var name = s_(r[0]);
      if (!name) return;
      people.push({ row: i + 2, name: name, pid: s_(r[1]), first: s_(r[2]), last: s_(r[3]), company: s_(r[4]), unit: s_(r[5]), phone: s_(r[6]) });
    });
  }

  var shD = sheet_(SHEETS.DROPDOWNS), companies = [], items = [];
  if (shD.getLastRow() > 1) {
    shD.getRange(2, 1, shD.getLastRow() - 1, 6).getDisplayValues().forEach(function (r) {
      if (s_(r[0])) companies.push(s_(r[0]));
      if (s_(r[5])) items.push({ cat: s_(r[2]), sub: s_(r[3]), sku: s_(r[4]), item: s_(r[5]) });
    });
  }

  var kit = {};
  var shK = ss_().getSheetByName(SHEETS.KIT);
  if (shK && shK.getLastRow() > 1) {
    shK.getRange(2, 1, shK.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var k = s_(r[0]), n = s_(r[1]); if (!k || !n) return;
      (kit[k] = kit[k] || []).push({ name: n, qty: Number(r[2]) || 1 });
    });
  }

  return {
    ok: true, role: role, email: ACTOR_.email, mode: authMode_(), viewerCanEditPeople: viewerCanEditPeople_(),
    version: new Date().toISOString(),
    statuses: STATUS_LIST,
    serials: serials, assignments: assignments, people: people, companies: companies, items: items, kit: kit,
    storage: storageRows_(true)
  };
}

// ------------------------------------------------------------ sign-out -----

function kitToString_(kit) {
  return (kit || []).map(function (k) {
    var n = s_(k.name), q = Number(k.qty) || 1;
    return n ? (q > 1 ? q + ' ' + n : n) : '';
  }).filter(Boolean).join(', ');
}

/**
 * payload = { code, name, signer, notes, lines:[{item, serial, kit:[{name,qty}]}], force }
 * Returns { ok, count, transferred, pdf:{id,url,download,name} }
 */
function signOut(payload) {
  var role = requireRole_(payload.code, true);
  var name = s_(payload.name);
  if (!name) throw new Error('חסר שם חייל');
  var lines = (payload.lines || []).map(function (l) {
    return { item: s_(l.item), serial: normSerial_(l.serial), kit: (l.kit || []).filter(function (k) { return s_(k.name); }) };
  }).filter(function (l) { return l.serial; });
  if (!lines.length) throw new Error('לא נבחרו פריטים');

  return withLock_(function () {
    var shA = sheet_(SHEETS.ASSIGN), shS = sheet_(SHEETS.SERIALS);
    ensureKitColumn_(shA);
    var sIdx = serialIndex_(shS), aIdx = assignIndex_(shA);

    var errors = [], toDelete = [];
    lines.forEach(function (l) {
      var s = sIdx[l.serial];
      if (!s) { errors.push('צ׳ ' + l.serial + ' לא קיים בטבלת צ'); return; }
      if (!l.item) l.item = s.item;
      var cur = aIdx[l.serial];
      if (cur) {
        if (cur.name === name) errors.push('צ׳ ' + l.serial + ' כבר מוחתם על ' + name);
        else if (payload.force) toDelete.push({ row: cur.row, name: cur.name, item: cur.item, serial: l.serial });
        else errors.push('צ׳ ' + l.serial + ' מוחתם על ' + cur.name + ' (אפשר לבחור "העבר")');
      } else if (s.status !== STATUS.OK && s.status !== STATUS.SIGNED) {
        errors.push('צ׳ ' + l.serial + ' במצב "' + s.status + '" – לא ניתן להחתמה');
      }
    });
    if (errors.length) throw new Error(errors.join('\n'));

    toDelete.sort(function (a, b) { return b.row - a.row; }).forEach(function (d) {
      deleteDataRow_(shA, d.row);
      log_(role, 'זיכוי (העברה)', d.name, d.item, d.serial, 'הועבר אל ' + name);
      closeStorageForSerial_(d.serial, role, 'העברה אל ' + name);
    });

    var start = lastAssignRow_(shA) + 1;
    lines.forEach(function (l, i) {
      var row = start + i;
      if (row > shA.getMaxRows()) shA.insertRowAfter(shA.getMaxRows());
      // C and E–H only. A, B, D are formulas (filled by ensureLookupFormulas_, never as values).
      writeCells_(shA, row, A_COL.NAME, [name]);
      writeCells_(shA, row, A_COL.ITEM, [l.item, l.serial, s_(payload.notes), kitToString_(l.kit)]);
      ensureLookupFormulas_(shA, row);
      setSerialStatus_(shS, sIdx, l.serial, STATUS.SIGNED);
    });
    SpreadsheetApp.flush();

    // PDF
    var pdf = null, pdfErr = '';
    try { pdf = createSignOutPdf_(formData_(name, lines, payload.notes, role, payload.signer)); }
    catch (e) {
      pdfErr = String(e && e.message || e);
      if (/access denied|permission|authoriz/i.test(pdfErr)) pdfErr += ' — יש להריץ testPdf() מעורך ה-Apps Script פעם אחת (אישור הרשאות Drive) ואז לפרוס גרסה חדשה';
    }

    lines.forEach(function (l) {
      log_(role, 'החתמה', name, l.item, l.serial, [s_(payload.signer) ? 'מחתים: ' + s_(payload.signer) : '', kitToString_(l.kit), s_(payload.notes)].filter(Boolean).join(' | '), pdf ? pdf.url : ('PDF נכשל: ' + pdfErr));
    });
    return { ok: true, count: lines.length, transferred: toDelete.length, pdf: pdf, pdfError: pdfErr };
  }, 'signOut');
}

/** Data object shared by the preview and the real PDF. */
function formData_(name, lines, notes, role, signer) {
  var shP = sheet_(SHEETS.PEOPLE), person = { name: name };
  if (shP.getLastRow() > 1) {
    shP.getRange(2, 1, shP.getLastRow() - 1, 7).getDisplayValues().some(function (r) {
      if (s_(r[0]) === name) { person = { name: name, pid: s_(r[1]), company: s_(r[4]), unit: s_(r[5]), phone: s_(r[6]) }; return true; }
      return false;
    });
  }
  return {
    title: 'טופס החתמת ציוד',
    battalion: ss_().getName(),
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    person: person,
    lines: lines.map(function (l) { return { item: l.item, serial: l.serial, kit: kitToString_(l.kit) }; }),
    notes: s_(notes),
    signer: s_(signer),
    issuedBy: ACTOR_.email || (role === 'admin' ? 'מנהל לוגיסטיקה' : 'צופה')
  };
}

/** Client: HTML preview of the form (same template as the PDF). payload = { code, name, notes, lines } */
function previewSignOut(payload) {
  requireRole_(payload.code, true);
  var lines = (payload.lines || []).map(function (l) { return { item: s_(l.item), serial: normSerial_(l.serial), kit: l.kit || [] }; });
  return { ok: true, html: formHtml_(formData_(s_(payload.name), lines, payload.notes, 'admin', payload.signer)) };
}

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function formHtml_(d) {
  var ext = !!d.summary;   // holdings form: extra columns (sign-out date, notes per line)
  var rows = d.lines.map(function (l, i) {
    return '<tr><td class="n">' + (i + 1) + '</td><td>' + esc_(l.item) + '</td><td class="num">' + esc_(l.serial) + '</td><td class="kit">' + esc_(l.kit || '—') + '</td>' +
      (ext ? '<td class="kit">' + esc_(l.notes || '') + '</td><td class="num">' + esc_(l.date || '') + '</td>' : '') + '</tr>';
  }).join('');
  var totals = '';
  if (ext && d.lines.length > 1) {
    var cnt = {}, order = [];
    d.lines.forEach(function (l) { if (!cnt[l.item]) { cnt[l.item] = 0; order.push(l.item); } cnt[l.item]++; });
    totals = '<div class="tot"><b>סיכום לפי פריט:</b> ' + order.map(function (k) { return esc_(k) + ' × ' + cnt[k]; }).join(' · ') + '</div>';
  }
  var decl = d.declaration || 'אני, החתום מטה, מאשר/ת כי קיבלתי את הציוד המפורט לעיל במצב תקין, וכי אני אחראי/ת לשמירתו ולהחזרתו.';
  var p = d.person;
  return '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>' + esc_(d.title) + '</title><style>' +
    '@page{size:A4;margin:16mm}' +
    'body{font-family:Arial,"Noto Sans Hebrew",sans-serif;color:#111;font-size:13px;margin:0;direction:rtl}' +
    '.hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #2f5d3a;padding-bottom:8px;margin-bottom:14px}' +
    'h1{font-size:22px;margin:0;color:#2f5d3a}.sub{color:#555;font-size:12px}' +
    '.meta{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:6px 14px;background:#f3f6f3;border-radius:8px;padding:10px 12px;margin-bottom:14px}' +
    '.meta b{color:#2f5d3a}' +
    'table{width:100%;border-collapse:collapse}th,td{border:1px solid #cfd8d0;padding:7px 8px;text-align:right;vertical-align:top}' +
    'th{background:#2f5d3a;color:#fff;font-weight:600}td.n{width:28px;text-align:center;color:#666}td.num{direction:ltr;text-align:right;font-family:monospace;white-space:nowrap}td.kit{color:#333;font-size:12px}' +
    '.notes{margin-top:12px;padding:8px 10px;border:1px dashed #b7c0c9;border-radius:6px;min-height:28px}' +
    '.sig{display:flex;justify-content:space-between;margin-top:34px;gap:30px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px;color:#444}' +
    '.decl{margin-top:16px;font-size:12px;color:#333;line-height:1.5}' +
    '.tot{margin-top:10px;font-size:12px;color:#333}' +
    'tr{page-break-inside:avoid}thead{display:table-header-group}' +
    '.ft{margin-top:22px;font-size:11px;color:#888;text-align:center}' +
    '</style></head><body>' +
    '<div class="hd"><div><h1>' + esc_(d.title) + '</h1><div class="sub">' + esc_(d.battalion) + '</div></div><div class="sub">תאריך: ' + esc_(d.date) + '</div></div>' +
    '<div class="meta">' +
    '<b>שם מלא</b><span>' + esc_(p.name) + '</span><b>מספר אישי</b><span>' + esc_(p.pid || '—') + '</span>' +
    '<b>פלוגה</b><span>' + esc_(p.company || '—') + '</span><b>מחלקה</b><span>' + esc_(p.unit || '—') + '</span>' +
    '<b>טלפון</b><span>' + esc_(p.phone || '—') + '</span><b>מספר פריטים</b><span>' + d.lines.length + '</span>' +
    '<b>' + esc_(d.signerTitle || 'מחתים') + '</b><span>' + esc_(d.signer || '—') + '</span><b>הופק ע״י</b><span>' + esc_(d.issuedBy) + '</span>' +
    '</div>' +
    '<table><thead><tr><th>#</th><th>פריט</th><th>צ׳</th><th>ציוד משלים</th>' + (ext ? '<th>הערות</th><th>תאריך החתמה</th>' : '') + '</tr></thead><tbody>' +
    (rows || '<tr><td colspan="' + (ext ? 6 : 4) + '" style="text-align:center;color:#888">אין ציוד מוחתם</td></tr>') + '</tbody></table>' + totals +
    (d.notes ? '<div class="notes"><b>הערות:</b> ' + esc_(d.notes) + '</div>' : '') +
    '<p class="decl">' + esc_(decl) + '</p>' +
    '<div class="sig"><div>חתימת ' + (ext ? 'החייל' : 'המקבל') + ': ' + esc_(p.name) + '</div><div>חתימת ' + esc_(d.signerTitle || 'המחתים') + ': ' + esc_(d.signer || '') + '</div></div>' +
    '<div class="ft">הופק אוטומטית ממערכת הלוגיסטיקה הגדודית · ' + esc_(d.date) + '</div>' +
    '</body></html>';
}

function pdfFolder_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('PDF_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ } }
  // auto: a folder next to the spreadsheet
  var file = DriveApp.getFileById(ss_().getId());
  var parents = file.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = parent.getFoldersByName(PDF_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : parent.createFolder(PDF_FOLDER_NAME);
  p.setProperty('PDF_FOLDER_ID', folder.getId());
  return folder;
}

function createSignOutPdf_(d) {
  var html = formHtml_(d);
  var blob = HtmlService.createHtmlOutput(html).getBlob().getAs(MimeType.PDF);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  var fname = stamp + '_' + d.person.name.replace(/[\/\\:*?"<>|]/g, ' ') + '_' + (d.fileTag || 'החתמה') + '.pdf';
  blob.setName(fname);
  var file = pdfFolder_().createFile(blob);
  var sharing = PropertiesService.getScriptProperties().getProperty('PDF_SHARING') || 'anyone';
  if (sharing === 'anyone') { try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { } }
  return { id: file.getId(), name: fname, url: file.getUrl(), download: 'https://drive.google.com/uc?export=download&id=' + file.getId() };
}

/** Client: list PDFs of one person (newest first) from the log. */
function getPersonPdfs(code, name) {
  requireRole_(code, false);
  var sh = logSheetRead_(), last = sh ? sh.getLastRow() : 0, out = {}, res = [];
  if (last <= 1) return { ok: true, files: [] };
  sh.getRange(2, 1, last - 1, 8).getDisplayValues().forEach(function (r) {
    if ((r[2] === 'החתמה' || r[2] === ACTION_HOLDINGS) && r[3] === s_(name) && /^https?:/.test(r[7]) && !out[r[7]]) {
      out[r[7]] = 1; res.push({ time: r[0], url: r[7], kind: r[2] === ACTION_HOLDINGS ? 'holdings' : 'signout' });
    }
  });
  res.reverse();
  return { ok: true, files: res };
}

// ------------------------------------------------------- holdings form -----
//
// "טופס ציוד חתום": one page with EVERYTHING currently signed to a person (from 'גדודי'),
// with the latest sign-out date of each serial taken from the log.
//   previewPersonForm – everyone (read-only) → HTML (the client shows it and can print it)
//   issuePersonForm   – admin → saves a PDF in the Drive folder, logs it, link appears on the soldier card

var ACTION_HOLDINGS = 'טופס ציוד חתום';

function holdingsData_(name) {
  name = s_(name);
  if (!name) throw new Error('חסר שם חייל');
  var shA = sheet_(SHEETS.ASSIGN), lastA = lastAssignRow_(shA), lines = [];
  if (lastA > ASSIGN_HEADER_ROWS) {
    shA.getRange(ASSIGN_HEADER_ROWS + 1, 1, lastA - ASSIGN_HEADER_ROWS, A_COL.KIT).getDisplayValues().forEach(function (r) {
      if (s_(r[A_COL.NAME - 1]) !== name) return;
      var serial = normSerial_(r[A_COL.SERIAL - 1]), item = s_(r[A_COL.ITEM - 1]);
      if (!serial && !item) return;
      lines.push({ item: item, serial: serial, kit: s_(r[A_COL.KIT - 1]), notes: s_(r[A_COL.NOTES - 1]), date: '' });
    });
  }
  // sign-out dates from the log (latest החתמה of that serial to this person)
  var sh = logSheetRead_();
  if (sh && sh.getLastRow() > 1 && lines.length) {
    var want = {}; lines.forEach(function (l) { if (l.serial) want[l.serial] = l; });
    var tz = Session.getScriptTimeZone();
    sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
      var l = want[normSerial_(r[5])];
      if (l && s_(r[2]) === 'החתמה' && s_(r[3]) === name && Object.prototype.toString.call(r[0]) === '[object Date]') {
        l.date = Utilities.formatDate(r[0], tz, 'dd/MM/yyyy');
      }
    });
  }
  lines.sort(function (a, b) { return a.item.localeCompare(b.item, 'he') || a.serial.localeCompare(b.serial, 'he', { numeric: true }); });
  return lines;
}

function holdingsForm_(name, signer, role) {
  var lines = holdingsData_(name);
  var d = formData_(s_(name), [], '', role, signer);
  d.lines = lines;            // already formatted (kit is a string here)
  d.summary = true;
  d.title = 'טופס ציוד חתום';
  d.fileTag = 'ציוד חתום';
  d.signerTitle = 'מאשר';
  d.declaration = 'אני, החתום מטה, מאשר/ת כי נכון לתאריך ' + d.date.split(' ')[0] + ' מוחתם/ת עליי הציוד המפורט לעיל, וכי אני אחראי/ת לשמירתו ולהחזרתו.';
  return d;
}

/** payload = { code, name, signer } → { ok, html, count } */
function previewPersonForm(payload) {
  var role = requireRole_(payload.code, false);
  var d = holdingsForm_(payload.name, payload.signer, role);
  return { ok: true, html: formHtml_(d), count: d.lines.length };
}

/** Admin: save the holdings form as a PDF. payload = { code, name, signer } → { ok, pdf, count } */
function issuePersonForm(payload) {
  var role = requireRole_(payload.code, true);
  var d = holdingsForm_(payload.name, payload.signer, role);
  if (!d.lines.length) throw new Error('אין ציוד מוחתם על ' + s_(payload.name));
  var pdf;
  try { pdf = createSignOutPdf_(d); }
  catch (e) {
    var msg = String(e && e.message || e);
    if (/access denied|permission|authoriz/i.test(msg)) msg += ' — ודא שיש לך הרשאת עריכה בתיקיית ה-PDF';
    throw new Error('ה-PDF לא נוצר: ' + msg);
  }
  log_(role, ACTION_HOLDINGS, d.person.name, '', '', d.lines.length + ' פריטים' + (s_(payload.signer) ? ' | מאשר: ' + s_(payload.signer) : ''), pdf.url);
  return { ok: true, pdf: pdf, count: d.lines.length };
}

// -------------------------------------------------------------- return -----

/** payload = { code, serials:[..], destination: STATUS.OK|BROKEN|BRIGADE, notes } */
function returnItems(payload) {
  var role = requireRole_(payload.code, true);
  var dest = s_(payload.destination) || STATUS.OK;
  if (STATUS_LIST.indexOf(dest) < 0) throw new Error('יעד זיכוי לא חוקי');
  var wanted = {};
  (payload.serials || []).forEach(function (s) { var k = normSerial_(s); if (k) wanted[k] = true; });
  if (!Object.keys(wanted).length) throw new Error('לא נבחרו פריטים');

  return withLock_(function () {
    var shA = sheet_(SHEETS.ASSIGN), shS = sheet_(SHEETS.SERIALS);
    var aIdx = assignIndex_(shA), sIdx = serialIndex_(shS);
    var rows = Object.keys(wanted).filter(function (k) { return aIdx[k]; }).map(function (k) { return { row: aIdx[k].row, name: aIdx[k].name, item: aIdx[k].item, serial: k }; });
    if (!rows.length) throw new Error('הצ׳ים שנבחרו לא נמצאו בטבלת גדודי');
    rows.sort(function (a, b) { return b.row - a.row; }).forEach(function (d) {
      deleteDataRow_(shA, d.row);
      setSerialStatus_(shS, sIdx, d.serial, dest);
      log_(role, 'זיכוי', d.name, d.item, d.serial, [dest, s_(payload.notes)].filter(Boolean).join(' | '));
      closeStorageForSerial_(d.serial, role, 'זיכוי');
    });
    SpreadsheetApp.flush();
    return { ok: true, count: rows.length, destination: dest };
  }, 'returnItems');
}

/** Admin: change the status of an unsigned serial (e.g. תקול → תקין). payload = { code, serial, status } */
function setStatus(payload) {
  var role = requireRole_(payload.code, true);
  var serial = normSerial_(payload.serial), status = s_(payload.status);
  if (STATUS_LIST.indexOf(status) < 0) throw new Error('סטטוס לא חוקי');
  return withLock_(function () {
    var shS = sheet_(SHEETS.SERIALS), sIdx = serialIndex_(shS), aIdx = assignIndex_(sheet_(SHEETS.ASSIGN));
    if (!sIdx[serial]) throw new Error('צ׳ לא נמצא');
    if (aIdx[serial]) throw new Error('הצ׳ מוחתם על ' + aIdx[serial].name + ' – יש לזכות קודם');
    var old = sIdx[serial].status;
    setSerialStatus_(shS, sIdx, serial, status);
    log_(role, 'שינוי סטטוס', '', sIdx[serial].item, serial, old + ' → ' + status);
    return { ok: true };
  }, 'setStatus');
}

/** Admin: make 'טבלת צ' statuses agree with 'גדודי'. Returns counts. */
function syncStatuses(code) {
  var role = requireRole_(code, true);
  return withLock_(function () {
    var shS = sheet_(SHEETS.SERIALS), sIdx = serialIndex_(shS), aIdx = assignIndex_(sheet_(SHEETS.ASSIGN));
    var toSigned = 0, toOk = 0;
    Object.keys(sIdx).forEach(function (k) {
      var s = sIdx[k];
      if (aIdx[k] && s.status !== STATUS.SIGNED) { setSerialStatus_(shS, sIdx, k, STATUS.SIGNED); toSigned++; }
      else if (!aIdx[k] && s.status === STATUS.SIGNED) { setSerialStatus_(shS, sIdx, k, STATUS.OK); toOk++; }
    });
    var missing = Object.keys(aIdx).filter(function (k) { return !sIdx[k]; }).length;
    log_(role, 'סנכרון סטטוסים', '', '', '', 'סומנו חתום: ' + toSigned + ', הוחזרו לתקין: ' + toOk + ', בגדודי בלי טבלת צ: ' + missing);
    SpreadsheetApp.flush();
    return { ok: true, toSigned: toSigned, toOk: toOk, missingInSerials: missing };
  }, 'syncStatuses');
}

// --------------------------------------------------------------- notes -----

function updateNotes(payload) {
  var role = requireRole_(payload.code, true);
  var serial = normSerial_(payload.serial);
  return withLock_(function () {
    var shA = sheet_(SHEETS.ASSIGN), a = assignIndex_(shA)[serial];
    if (!a) throw new Error('צ׳ לא נמצא');
    if (payload.notes !== undefined) writeCells_(shA, a.row, A_COL.NOTES, [s_(payload.notes)]);
    if (payload.kit !== undefined) { ensureKitColumn_(shA); writeCells_(shA, a.row, A_COL.KIT, [s_(payload.kit)]); }
    log_(role, 'עדכון הערה', a.name, a.item, serial, [s_(payload.notes), s_(payload.kit)].filter(Boolean).join(' | '));
    return { ok: true };
  }, 'updateNotes');
}

// ---------------------------------------------------------------- stock ----

function addSerials(payload) {
  var role = requireRole_(payload.code, true);
  var item = s_(payload.item), cat = s_(payload.cat);
  if (!item) throw new Error('חסר שם פריט');
  var list = (payload.serials || []).map(normSerial_).filter(Boolean);
  if (!list.length) throw new Error('לא הוזנו צ׳ים');
  var status = STATUS_LIST.indexOf(s_(payload.status)) >= 0 ? s_(payload.status) : STATUS.OK;
  return withLock_(function () {
    var shS = sheet_(SHEETS.SERIALS), sIdx = serialIndex_(shS);
    var dup = list.filter(function (k) { return sIdx[k]; });
    if (dup.length) throw new Error('צ׳ים שכבר קיימים: ' + dup.join(', '));
    var rows = list.map(function (k) { return [cat, item, k, status]; });
    shS.getRange(shS.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    list.forEach(function (k) { log_(role, 'הוספת צ׳', '', item, k, cat + ' | ' + status); });
    SpreadsheetApp.flush();
    return { ok: true, count: rows.length };
  }, 'addSerials');
}

function removeSerials(payload) {
  var role = requireRole_(payload.code, true);
  var wanted = {};
  (payload.serials || []).forEach(function (s) { var k = normSerial_(s); if (k) wanted[k] = true; });
  if (!Object.keys(wanted).length) throw new Error('לא נבחרו צ׳ים');
  return withLock_(function () {
    var aIdx = assignIndex_(sheet_(SHEETS.ASSIGN));
    var blocked = Object.keys(wanted).filter(function (k) { return aIdx[k]; });
    if (blocked.length) throw new Error('צ׳ים מוחתמים – יש לזכות קודם: ' + blocked.join(', '));
    var shS = sheet_(SHEETS.SERIALS), sIdx = serialIndex_(shS);
    var rows = Object.keys(wanted).filter(function (k) { return sIdx[k]; }).map(function (k) { return { row: sIdx[k].row, item: sIdx[k].item, serial: k }; });
    rows.sort(function (a, b) { return b.row - a.row; }).forEach(function (d) { shS.deleteRow(d.row); log_(role, 'מחיקת צ׳', '', d.item, d.serial, ''); });
    SpreadsheetApp.flush();
    return { ok: true, count: rows.length };
  }, 'removeSerials');
}

function addItemType(payload) {
  var role = requireRole_(payload.code, true);
  var item = s_(payload.item);
  if (!item) throw new Error('חסר שם פריט');
  var shD = sheet_(SHEETS.DROPDOWNS);
  var existing = shD.getRange(2, 6, Math.max(1, shD.getLastRow() - 1), 1).getDisplayValues().map(function (r) { return s_(r[0]); });
  if (existing.indexOf(item) >= 0) throw new Error('הפריט כבר קיים ברשימה');
  var row = 2;
  while (row <= shD.getLastRow() && s_(shD.getRange(row, 6).getValue())) row++;
  shD.getRange(row, 3, 1, 4).setValues([[s_(payload.cat), s_(payload.sub), s_(payload.sku), item]]);
  log_(role, 'הוספת פריט', '', item, '', s_(payload.cat) + ' / ' + s_(payload.sub));
  SpreadsheetApp.flush();
  return { ok: true };
}

/** Admin: replace the accessory kit of one item type. payload = { code, item, kit:[{name,qty}] } */
function saveKit(payload) {
  var role = requireRole_(payload.code, true);
  var item = s_(payload.item);
  if (!item) throw new Error('חסר שם פריט');
  var kit = (payload.kit || []).filter(function (k) { return s_(k.name); }).map(function (k) { return [item, s_(k.name), Number(k.qty) || 1]; });
  return withLock_(function () {
    var ss = ss_(), sh = ss.getSheetByName(SHEETS.KIT);
    if (!sh) { sh = ss.insertSheet(SHEETS.KIT); sh.appendRow(['פריט צ', 'שם פריט', 'כמות']); sh.setRightToLeft(true); }
    var last = sh.getLastRow();
    if (last > 1) {
      var vals = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
      for (var i = vals.length - 1; i >= 0; i--) if (s_(vals[i][0]) === item) sh.deleteRow(i + 2);
    }
    if (kit.length) sh.getRange(sh.getLastRow() + 1, 1, kit.length, 3).setValues(kit);
    log_(role, 'עדכון תקן', '', item, '', kitToString_(kit.map(function (r) { return { name: r[1], qty: r[2] }; })));
    SpreadsheetApp.flush();
    return { ok: true, count: kit.length };
  }, 'saveKit');
}

// --------------------------------------------------------------- people ----

/**
 * Create or update a person in 'אלפון גדודי'.
 * payload = { code, row (0 = new), first, last, pid, company, unit, phone }
 * Full name = first + ' ' + last. Renaming cascades to 'גדודי' (it is the VLOOKUP key).
 */
function savePerson(payload) {
  var row = Number(payload.row) || 0;
  // codes mode: editing an existing soldier is allowed for the view role too; creating a new one is admin-only.
  // sheet mode: a viewer has no write access to the spreadsheet, so all edits are admin-only.
  var role = requireRole_(payload.code, !row || !viewerCanEditPeople_());
  var first = s_(payload.first), last = s_(payload.last), pid = normSerial_(payload.pid);
  if (!first || !last) throw new Error('חסר שם פרטי או שם משפחה');
  var name = (first + ' ' + last).replace(/\s+/g, ' ').trim();   // expected result of the column-A formula
  return withLock_(function () {
    var shP = sheet_(SHEETS.PEOPLE), lastP = lastPeopleRow_(shP);
    var rows = lastP > PEOPLE_HEADER_ROWS ? shP.getRange(PEOPLE_HEADER_ROWS + 1, 1, lastP - PEOPLE_HEADER_ROWS, 7).getDisplayValues() : [];
    var oldName = '', oldVals = null;
    for (var i = 0; i < rows.length; i++) {
      var r = PEOPLE_HEADER_ROWS + 1 + i, rn = s_(rows[i][0]), rp = normSerial_(rows[i][1]);
      if (r === row) { oldName = rn; oldVals = rows[i].slice(P_COL.PID - 1); continue; }
      if (rn && rn === name) throw new Error('כבר קיים חייל בשם "' + name + '"');
      if (pid && rp && rp === pid) throw new Error('מספר אישי ' + pid + ' כבר שייך ל-' + rn);
    }
    if (row && !oldName) throw new Error('השורה לא נמצאה – רענן ונסה שוב');
    var isNew = !row;
    if (isNew) row = lastP + 1;

    // B–G only. Column A (שם מלא) is a formula built from C+D – never written as a value.
    writeCells_(shP, row, P_COL.PID, [pid, first, last, s_(payload.company), s_(payload.unit), s_(payload.phone)]);
    if (isNew) fillFormulas_(shP, row, PEOPLE_HEADER_ROWS);
    SpreadsheetApp.flush();

    // The real name is whatever the formula produced.
    var actual = s_(shP.getRange(row, P_COL.NAME).getDisplayValue());
    var undo = function (msg) {
      if (isNew) shP.getRange(row, P_COL.PID, 1, P_COL.PHONE - P_COL.PID + 1).clearContent();
      else writeCells_(shP, row, P_COL.PID, oldVals);
      SpreadsheetApp.flush();
      throw new Error(msg);
    };
    if (!actual || /^#/.test(actual)) undo('עמודה A (שם מלא) באלפון לא חישבה שם לשורה ' + row + ' – בדוק שיש בה נוסחה. השינוי בוטל.');
    for (var j = 0; j < rows.length; j++) {
      if (PEOPLE_HEADER_ROWS + 1 + j !== row && s_(rows[j][0]) === actual) undo('כבר קיים חייל בשם "' + actual + '" – השינוי בוטל');
    }

    var renamed = 0;
    if (oldName && oldName !== actual) {
      var shA = sheet_(SHEETS.ASSIGN), lastA = lastAssignRow_(shA);
      if (lastA > ASSIGN_HEADER_ROWS) {
        var names = shA.getRange(ASSIGN_HEADER_ROWS + 1, A_COL.NAME, lastA - ASSIGN_HEADER_ROWS, 1).getDisplayValues();
        names.forEach(function (n, i) { if (s_(n[0]) === oldName) { writeCells_(shA, ASSIGN_HEADER_ROWS + 1 + i, A_COL.NAME, [actual]); renamed++; } });
      }
    }
    // active storage rows follow the soldier (name / company / pid)
    if (oldName) {
      storageRows_(true).forEach(function (r) {
        if (r.name !== oldName) return;
        storageSheet_().getRange(r.row, ST_COL.COMPANY, 1, 3).setValues([[s_(payload.company) || r.company, actual, pid || r.pid]]);
      });
    }
    log_(role, oldName ? 'עדכון חייל' : 'חייל חדש', actual, '', pid, [s_(payload.company), s_(payload.unit), s_(payload.phone)].filter(Boolean).join(' · ') + (renamed ? ' | שונה שם ב-' + renamed + ' שורות' : ''));
    SpreadsheetApp.flush();
    return { ok: true, name: actual, row: row, renamed: renamed };
  }, 'savePerson');
}

/** Delete a person (only if nothing is signed to them). payload = { code, row, name } */
function deletePerson(payload) {
  var role = requireRole_(payload.code, true);
  var row = Number(payload.row) || 0, name = s_(payload.name);
  return withLock_(function () {
    var shP = sheet_(SHEETS.PEOPLE);
    if (row < 2 || s_(shP.getRange(row, 1).getValue()) !== name) throw new Error('החייל לא נמצא – רענן ונסה שוב');
    var aIdx = assignIndex_(sheet_(SHEETS.ASSIGN));
    var held = Object.keys(aIdx).filter(function (k) { return aIdx[k].name === name; }).length;
    if (held) throw new Error('על ' + name + ' מוחתמים ' + held + ' פריטים – יש לזכות קודם');
    deleteDataRow_(shP, row);
    log_(role, 'מחיקת חייל', name, '', '', '');
    SpreadsheetApp.flush();
    return { ok: true };
  }, 'deletePerson');
}

// ----------------------------------------------------------------- log -----

function getLog(code, limit) {
  requireRole_(code, false);
  var sh = logSheetRead_(), last = sh ? sh.getLastRow() : 0;
  limit = Math.min(Number(limit) || 200, 1000);
  if (last <= 1) return { ok: true, rows: [] };
  var n = Math.min(limit, last - 1);
  var vals = sh.getRange(last - n + 1, 1, n, 8).getDisplayValues();
  vals.reverse();
  return { ok: true, rows: vals.map(function (r) { return { time: r[0], role: r[1], action: r[2], name: r[3], item: r[4], serial: r[5], notes: r[6], link: r[7] }; }) };
}

/**
 * EDITOR: pick this function → Run.
 * Puts the formula back in every data row where a formula column ('גדודי' A/B/D, 'אלפון גדודי' A)
 * holds a plain value or is empty. Template = the formula most rows in that column use (R1C1).
 * Existing formulas are never touched; ARRAYFORMULA columns are skipped. Overwritten values go to the log.
 */
function repairFormulaColumns() {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var out = [];
    [[SHEETS.ASSIGN, ASSIGN_HEADER_ROWS, lastAssignRow_], [SHEETS.PEOPLE, PEOPLE_HEADER_ROWS, lastPeopleRow_]].forEach(function (d) {
      var sh = sheet_(d[0]), hdr = d[1], last = d[2](sh);
      if (last <= hdr) return;
      var n = last - hdr;
      formulaCols_(sh).forEach(function (c) {
        var label = d[0] + ' עמודה ' + colLetter_(c);
        var rng = sh.getRange(hdr + 1, c, n, 1), f = rng.getFormulasR1C1(), v = rng.getDisplayValues();
        if (/ARRAYFORMULA/i.test(f[0][0])) { out.push(label + ': ARRAYFORMULA – דילגתי'); return; }
        var tpl = commonFormula_(f);
        if (!tpl) { out.push(label + ': אין אף נוסחה בעמודה – אין ממה להעתיק, לא שיניתי'); return; }
        var fixed = [];
        for (var i = 0; i < n; i++) {
          if (f[i][0]) continue;
          var row = hdr + 1 + i;
          fixed.push(row + (s_(v[i][0]) ? ' (היה: ' + s_(v[i][0]) + ')' : ' (ריק)'));
          sh.getRange(row, c).setFormulaR1C1(tpl);
        }
        out.push(label + ': ' + (fixed.length ? 'תוקנו ' + fixed.length + ' שורות – ' + fixed.join(', ') : 'תקין'));
      });
    });
    SpreadsheetApp.flush();
    Logger.log(out.join('\n'));
    return out;
  } finally { lock.releaseLock(); }
}

// -------------------------------------------------------------- storage ----

function storageSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(SHEETS.STORAGE);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.STORAGE);
    sh.getRange(1, 1, 1, STORAGE_HEADERS.length).setValues([STORAGE_HEADERS]);
    sh.setFrozenRows(1); sh.setRightToLeft(true);
  }
  return sh;
}
/** Last row in 'אפסון' with data in A–E. */
function lastStorageRow_(sh) {
  var last = sh.getLastRow();
  if (last <= STORAGE_HEADER_ROWS) return STORAGE_HEADER_ROWS;
  var vals = sh.getRange(STORAGE_HEADER_ROWS + 1, 1, last - STORAGE_HEADER_ROWS, ST_COL.SERIAL).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (vals[i].some(function (v) { return s_(v); })) return STORAGE_HEADER_ROWS + 1 + i;
  return STORAGE_HEADER_ROWS;
}
/** serial '0' / '' → '' (item without a serial). */
function storageSerial_(v) { var k = normSerial_(v); return k === '0' ? '' : k; }
/** Rows of 'אפסון'. activeOnly → only rows with an empty 'תאריך הוצאה מאפסון'. */
function storageRows_(activeOnly) {
  var sh = ss_().getSheetByName(SHEETS.STORAGE), out = [];
  if (!sh) return out;
  var last = lastStorageRow_(sh);
  if (last <= STORAGE_HEADER_ROWS) return out;
  sh.getRange(STORAGE_HEADER_ROWS + 1, 1, last - STORAGE_HEADER_ROWS, ST_COL.OUT).getDisplayValues().forEach(function (r, i) {
    var name = s_(r[ST_COL.NAME - 1]), item = s_(r[ST_COL.ITEM - 1]);
    if (!name && !item) return;
    var outDate = s_(r[ST_COL.OUT - 1]);
    if (activeOnly && outDate) return;
    out.push({
      row: STORAGE_HEADER_ROWS + 1 + i, company: s_(r[ST_COL.COMPANY - 1]), name: name, pid: s_(r[ST_COL.PID - 1]),
      item: item, serial: storageSerial_(r[ST_COL.SERIAL - 1]), inDate: s_(r[ST_COL.IN - 1]), outDate: outDate
    });
  });
  return out;
}
/** Fill 'תאריך הוצאה מאפסון' of the active row(s) of a serial. Used by זיכוי / העברה. */
function closeStorageForSerial_(serial, role, reason) {
  if (!serial) return 0;
  var n = 0;
  storageRows_(true).forEach(function (r) {
    if (r.serial !== serial) return;
    storageSheet_().getRange(r.row, ST_COL.OUT).setValue(new Date());
    log_(role, 'הוצאה מאפסון', r.name, r.item, r.serial, 'אוטומטי – ' + reason);
    n++;
  });
  return n;
}

/**
 * Put items in storage.
 * payload = { code, name, notes, lines:[{item, serial}] }  – serial '' = item without a serial.
 * A serial must be signed on that soldier in 'גדודי' and not already in storage.
 */
function storeItems(payload) {
  var role = requireRole_(payload.code, true);
  var name = s_(payload.name);
  if (!name) throw new Error('חסר שם חייל');
  var lines = (payload.lines || []).map(function (l) { return { item: s_(l.item), serial: storageSerial_(l.serial) }; })
    .filter(function (l) { return l.item || l.serial; });
  if (!lines.length) throw new Error('לא נבחרו פריטים');

  return withLock_(function () {
    var aIdx = assignIndex_(sheet_(SHEETS.ASSIGN));
    var active = {}; storageRows_(true).forEach(function (r) { if (r.serial) active[r.serial] = r; });

    // soldier details: directory first, 'גדודי' as fallback
    var person = { company: '', pid: '' };
    var shP = sheet_(SHEETS.PEOPLE), lastP = lastPeopleRow_(shP);
    if (lastP > PEOPLE_HEADER_ROWS) shP.getRange(PEOPLE_HEADER_ROWS + 1, 1, lastP - PEOPLE_HEADER_ROWS, 7).getDisplayValues().some(function (r) {
      if (s_(r[0]) !== name) return false;
      person = { company: s_(r[P_COL.COMPANY - 1]), pid: s_(r[P_COL.PID - 1]) }; return true;
    });

    var errors = [], seen = {};
    lines.forEach(function (l) {
      if (!l.serial) { if (!l.item) errors.push('חסר שם פריט'); return; }
      if (seen[l.serial]) { errors.push('צ׳ ' + l.serial + ' נבחר פעמיים'); return; }
      seen[l.serial] = 1;
      var a = aIdx[l.serial];
      if (!a) errors.push('צ׳ ' + l.serial + ' לא מוחתם על אף חייל');
      else if (a.name !== name) errors.push('צ׳ ' + l.serial + ' מוחתם על ' + a.name + ', לא על ' + name);
      else if (active[l.serial]) errors.push('צ׳ ' + l.serial + ' כבר באפסון (מ-' + active[l.serial].inDate + ')');
      if (a && !l.item) l.item = a.item;
    });
    if (errors.length) throw new Error(errors.join('\n'));
    if (!person.company || !person.pid) {
      var any = Object.keys(aIdx).map(function (k) { return aIdx[k]; }).filter(function (a) { return a.name === name; })[0];
      if (any) {
        var shA = sheet_(SHEETS.ASSIGN), r = shA.getRange(any.row, 1, 1, A_COL.PID).getDisplayValues()[0];
        if (!person.company) person.company = s_(r[A_COL.COMPANY - 1]).replace(/^#N\/A$/, '');
        if (!person.pid) person.pid = s_(r[A_COL.PID - 1]).replace(/^#N\/A$/, '');
      }
    }

    var sh = storageSheet_(), start = lastStorageRow_(sh) + 1, now = new Date();
    var rows = lines.map(function (l) { return [person.company, name, person.pid, l.item, l.serial, now, '']; });
    sh.getRange(start, 1, rows.length, ST_COL.OUT).setValues(rows);
    lines.forEach(function (l) { log_(role, 'אפסון', name, l.item, l.serial, [person.company, s_(payload.notes)].filter(Boolean).join(' | ')); });
    SpreadsheetApp.flush();
    return { ok: true, count: lines.length };
  }, 'storeItems');
}

/**
 * Take items out of storage (fills 'תאריך הוצאה מאפסון'; the row stays as history).
 * payload = { code, notes, rows:[{row, name, item, serial}] } – row content is re-checked before writing.
 */
function releaseItems(payload) {
  var role = requireRole_(payload.code, true);
  var want = (payload.rows || []).filter(function (r) { return Number(r.row) > STORAGE_HEADER_ROWS; });
  if (!want.length) throw new Error('לא נבחרו פריטים');
  return withLock_(function () {
    var byRow = {}; storageRows_(true).forEach(function (r) { byRow[r.row] = r; });
    var errors = [];
    var hits = want.map(function (w) {
      var r = byRow[Number(w.row)];
      if (!r || r.name !== s_(w.name) || r.item !== s_(w.item) || r.serial !== storageSerial_(w.serial)) {
        errors.push((s_(w.item) || '') + ' ' + (storageSerial_(w.serial) || '') + ' – כבר לא באפסון או שהטבלה השתנתה');
        return null;
      }
      return r;
    });
    if (errors.length) throw new Error(errors.join('\n') + '\nרענן ונסה שוב');
    var sh = storageSheet_(), now = new Date();
    hits.forEach(function (r) {
      sh.getRange(r.row, ST_COL.OUT).setValue(now);
      log_(role, 'הוצאה מאפסון', r.name, r.item, r.serial, s_(payload.notes));
    });
    SpreadsheetApp.flush();
    return { ok: true, count: hits.length };
  }, 'releaseItems');
}