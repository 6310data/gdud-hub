# Logistics — in-app import from the Google Sheet

Date: 2026-10-22 · Status: draft for approval · Mockup: `.superpowers/brainstorm/*/content/import-screens.html` (made-up data)

## Why

For the rest of the current סבב the logistics Google Sheet ("לוגיסטיקה גדודית") stays the official record.
The app runs alongside it as a test copy, so it has to be refreshed from the sheet again and again, not once.

Today the only way in is `packages/db/scripts/import-logistics.ts`: a command-line script that reads CSV
exports, connects with `MIGRATION_DATABASE_URL` (bypassing RLS), and only **adds** missing rows. That is
fine for a developer doing a first fill, but:

- the people who need to refresh the app (the logistics admin) don't use a command line;
- a second run never picks up changes: a weapon returned in the sheet, a status changed to תקול, a weapon
  moved to another soldier — all ignored;
- there is no way to see or control what will be overwritten.

## Goals

1. A logistics admin can refresh the app from the sheet from a page in the app, in a few clicks.
2. They choose **which sheet tabs** to import.
3. Before anything is saved they see a **preview** of every change, line by line, and can untick single lines.
4. The import updates existing records (not only adds), so repeated imports keep the app in step with the sheet.
5. Every import is recorded: who, when, and what changed.

## Non-goals

- Writing anything back to the Google Sheet. The sheet is never touched.
- A live/automatic link to Google (Sheets API, service account, Apps Script push). Not now: it would put a
  Google credential with access to personal data in the app and needs separate ביטחון מידע approval.
- Creating companies or platoons. Units stay managed in `/admin/units`.
- Replacing the CLI. It stays for developers; the two share one mapping (see "Shared core").

## Anti-goals (would be a failure even if it "works")

- Changes saved without the admin having seen them in the preview.
- Silent deletion of things people entered in the app during testing.
- Rows that can't be read disappearing without a word.
- The uploaded file (real names, personal numbers, phones) being stored anywhere.
- Bypassing RLS from a request (`systemDb()` in request code).

## Who

Decided by the user: only the **logistics admin** or a **system admin**.

- Logistics admin = `logistics/admin` membership at battalion level, i.e. `logisticsAccess().isStockAdmin`.
  A company-scoped logistics admin does **not** get the page.
- System admin = `isSuperAdmin` (already passes `can()`).
- Page guard: `requireModule("logistics")` then `isStockAdmin`; the Server Actions re-check the same and all
  writes run in `withUser(session.claims, …)` so RLS checks again. A battalion-level logistics admin already
  passes every logistics policy (migration 0003). The import never writes to `people`.

## The flow (as agreed on the mockup)

### Screen 1 — `/logistics/import`: upload and choose tabs

- Short instructions: Google Sheets → קובץ → הורדה → Microsoft Excel (.xlsx), then upload here.
- Upload one `.xlsx` file. The app lists the tabs it recognised, with row counts, each with a checkbox.
  Recognised tabs are the six the CLI knows (`SHEET_NAMES`): טבלת צ, גדודי, אפסון, אלפון גדודי,
  תקן ציוד משלים, Dropdowns. Unrecognised tabs are listed greyed out ("לא נתמך").
- Note under the list: "הגיליון לא משתנה. הייבוא רק מעדכן את האפליקציה לפי הגיליון."
- Button: "הצג מה ישתנה". Nothing is written at this step.
- Entry point: a row on the logistics home, visible only to users who may import.

### Screen 2 — preview

- One tab per chosen sheet tab with its change count.
- Summary: new / will change / only in the app / couldn't read / identical (identical rows are not listed).
- Table, grouped, each line with: checkbox, change type, sheet row number, item, צ׳ (`<Serial>`), and
  "now in the app → after import" (old value struck through).
  - **ישתנו (will change)** — sheet differs from app. **Ticked by default: the sheet wins.** Unticking keeps
    the app's value. (User confirmed.)
  - **חדשים (new)** — in the sheet, missing from the app. Ticked by default.
  - **רק באפליקציה (only in the app)** — exists in the app, not in the sheet. **Unticked by default: nothing
    is removed unless the admin ticks it.** (User confirmed.)
  - **לא נקראו (couldn't read)** — rows that can't be mapped (duplicate צ׳, missing צ׳, unknown company or
    platoon, person not found…). No checkbox; each says what to fix in the sheet. Never imported.
- Footer: "N שינויים מסומנים מתוך M · K שורות לא ייובאו", buttons חזרה and "ייבא N שינויים".
- After import: a result screen with what was applied, and a link to the import record.

## What a "change" means per tab

The key decides whether a sheet row and an app record are "the same thing". Values are compared after the
same normalisation the CLI uses (`normalizeSerial`, `searchKey`, `statusToCondition`, `parseSheetDate`,
`parseKitText`).

| Tab | Key | "Will change" when | "Only in app" — what ticking does |
|---|---|---|---|
| טבלת צ | normalised צ׳ | condition differs. (An item-type difference is **not** applied: 0003 forbids changing a serial's item, and delete + re-add would lose history. It is listed under "couldn't read": "סוג הפריט שונה מהאפליקציה — לתיקון ידני".) | delete the serial if it has never been signed out; otherwise not offered (listed as info) |
| גדודי | normalised צ׳ (open assignment) | holder differs (→ return from current holder, sign to sheet holder), or kit text differs | return the open assignment (close it today) |
| אלפון גדודי | personal number | — never: soldier details are owned by דוח 1 (see "Soldiers") | — never |
| אפסון | soldier + צ׳/item + storage date | release date appears or differs | release the storage row |
| תקן ציוד משלים | item + kit line name | — (lines are only added or removed) | remove the kit line |
| Dropdowns | item name | category / sub-category differ | not offered (catalogue items are never removed by import) |

### Soldiers — one source of truth (decided by the user)

דוח 1 is the only place that owns soldiers and the only place that may edit a soldier's details. The
logistics sheet's אלפון is a stale copy of דוח 1's list, and ending that duplication is one of the reasons
for the app. So the logistics import **never edits or deactivates** a soldier in the shared `people` table:

- Sheet rows (גדודי, אפסון) are linked to soldiers by **personal number**; the אלפון tab is only used to
  find a soldier's personal number when a row has just a name.
- Name / phone / platoon differences between the logistics אלפון and the app are not offered as changes.
- A soldier the app doesn't have yet is **not created** (decided by the user). Every row that points at
  them goes under "couldn't read" with "החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1". Once דוח 1 has
  them, the next import picks the rows up as new. (While the דוח 1 pilot covers one company, expect many
  such rows for the other companies; the preview groups them per soldier so it stays readable.)
- On screen 1 the אלפון גדודי tab is labelled "לאיתור מספר אישי בלבד" — choosing it never writes anything.

Cross-tab rules carried over from the CLI: soldiers are resolved before assignments and storage; a צ׳ or item
that appears only in גדודי / טבלת צ is created and flagged. If the admin unticks a line that another ticked
line depends on (e.g. unticks a new צ׳ but keeps a new assignment of it), the dependent line becomes
"couldn't read" in the result with the reason — it is not applied.

## Applying safely

- **Nothing is stored between preview and import.** The browser keeps the file; "ייבא" sends the file again
  plus the list of ticked line ids and a fingerprint of the preview. The server parses and diffs again in
  the import transaction; if the fingerprint no longer matches (someone changed the app in between), it
  aborts with "האפליקציה השתנתה מאז התצוגה המקדימה — הצג שוב" and writes nothing.
- One transaction for the whole import, inside `withUser`. Any failure rolls back everything.
- Line ids are stable for a given file and app state: `<tab>:<key>:<change kind>`.
- File limits: `.xlsx` only, at most 4 MB (Vercel caps a request at 4.5 MB), checked by type and size before parsing; parsing errors are shown
  as a user error, never a stack trace.
- The file is parsed in memory and dropped; it is not written to disk, storage or logs. Logs never include
  cell values.

## Record of each import

- Row changes are already captured by the existing `audit_log` triggers with the acting user.
- In addition, one `logistics_events` row per import (no soldier, battalion-wide, like stock events)
  of a new kind "ייבוא מהגיליון", with: file name, tabs chosen, counts per group, number of lines unticked.
  It shows in `/logistics/log`. (Builder: add the event kind; the insert policy already allows battalion
  admins to write events without a soldier.)

## Shared core

Move the sheet mapping out of `packages/db/scripts/logistics-import.ts` into importable code (e.g.
`packages/db/src/logistics-sheet/`) with three parts:

1. **read** — `.xlsx` (app) or CSV folder (CLI) → `Sheets` (same `SheetRow` shape as today).
2. **diff** — `Sheets` + current DB state → a list of change lines grouped as above, each with id, tab, row,
   kind, before/after, dependencies. Pure apart from reading the DB.
3. **apply** — change lines minus the unticked ids → writes, inside the caller's transaction.

The CLI becomes: read CSV → diff → apply the **new** lines only — exactly today's "add missing" behaviour,
so a developer run never overwrites or removes app data. No flags for the other groups (not needed now);
`--dry-run` prints the full diff. The app uses the same functions through Server Actions.
The existing PGlite test (`packages/db/test/import-logistics.test.ts`) keeps passing and gains cases for
changes, "only in app" and unticked lines.

## Constraints

- Hebrew, RTL, Tzelem (`@gdud/ui`, `tz-` classes, tokens only). צ׳ / personal numbers / phones via `<Serial>`.
- Next.js 16 conventions (async `params`, Server Actions, `proxy.ts`).
- New dependency for `.xlsx` must pass pnpm `minimumReleaseAge`; use `read-excel-file` (read-only, maintained, MIT, small dependency tree). Do
  **not** use the npm `xlsx` package (stale, known advisories).
- No new table is needed; if the builder adds one anyway, it needs RLS + grants + audit trigger + RLS tests.
- `pnpm test && pnpm typecheck && pnpm lint` green.
- Data: real personal data (docs/SECURITY.md). The user confirmed ביטחון מידע approval covers the logistics
  data in the app, as it does for דוח 1.
- The דוח 1 design (2026-10-22-doch1-design.md) plans the same kind of in-app import pipeline (upload →
  parse on the server → preview → confirm, file not stored). Whichever lands first, the `.xlsx` reading and
  the preview table should be written so the other can reuse them.

## Left to the builder

- Exact component structure, how the file is held client-side between the two steps, preview pagination
  (the identical rows are hidden, so expected change lists are small — tens, not hundreds).
- The fingerprint function.
- Wording of individual error messages (Hebrew, specific, says what to fix in the sheet).
- Whether the result screen is a separate route or a state of the same page.

## Calls I made (not discussed with the user)

- Upload of a downloaded `.xlsx`, not a live Google link (security; see non-goals).
- Gate = battalion-level logistics admin (`isStockAdmin`) or super admin; company-level admins excluded.
- Units are never created by the in-app import; unknown companies/platoons are "couldn't read".
- "Only in app" removal semantics per tab (table above): return/release/inactivate rather than delete,
  except never-used serials and kit lines.
- No server-side storage of the file or preview; re-send + fingerprint instead.
- One summary event per import in the logistics log.
- A serial whose item type differs is never changed by import; it is listed for manual fixing.
- The CLI keeps applying new lines only. Because it shares the core, it also stops creating soldiers and
  platoons (today it creates both); a developer fills `people` the דוח 1 way.
