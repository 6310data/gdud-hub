# מחלקת קשר — design

Date: 2026-10-27 · Module id: `kesher` · Status: draft for approval (open questions answered 2026-10-27)

## Sources

- **Mockup** (source of truth for UI): `references/Kesher/mockup/kesher.html`. It loads the real `tzelem.css` and fonts, so open it through a server at the repo root (`python3 -m http.server`, then `/references/Kesher/mockup/kesher.html`). Its screens are hash routes; below, "screen `#/sign`" means that route. All names and צ׳ in it are made up. Where the mockup shows a typed name (signer, holder, issuer, reporter), this spec replaces it with a soldier picker or the signed-in user — see "Soldiers".
- **The old app:** `references/Kesher/Code.js.txt` (Apps Script `webapp_server`) and `references/Kesher/Index.html` (`webapp_ui`, exported as RTF-HTML: strip the `<p>`/`<span>` wrappers to read it). Behaviour questions are settled by reading these.
- **The sheet:** `references/Kesher/פיזור ושליטה מחלקת קשר.xlsx` — real names, emails and access codes. Git-ignored (`*.xlsx`); stays on the machine. Its layout is written up under "Import" below so nobody needs to open it to build.
- **Patterns to copy:** the logistics module — `packages/db/src/schema/logistics.ts`, `migrations/0003_logistics_security.sql`, `packages/db/src/logistics-sheet/` (read → diff → apply), `apps/web/src/app/(shell)/logistics/` — the doch1 push code (`apps/web/src/lib/doch1/push.ts`, `reminder-job.ts`, `app/api/doch1/cron/route.ts`, `doch1/_components/push-toggle.tsx`), `docs/ADDING_A_MODULE.md` and `docs/superpowers/specs/2026-10-22-logistics-sheet-import-design.md`.

## Intent

The communications department (מחלקת קשר) tracks every device with a צ׳ (710, אולר, מגן מכלול …) and the accessories that go with them (ציוד משלים: batteries, antennas, adapters, handsets) across the battalion's companies. Today this lives in a Google Sheet ("פיזור ושליטה מחלקת קשר") with an Apps Script web app in front of it: access codes instead of accounts, soldiers' names typed by hand, one big snapshot loaded per visit, formulas that break (`#REF!`, `#N/A` across the company tabs), and every write going through `LockService` on a shared spreadsheet.

In gdud-hub the department gets its own app on the shared platform: Google sign-in and the hub's memberships instead of access codes, soldiers from דוח 1's list instead of typed names, companies from the shared `units` tree, RLS instead of "whoever has the link", push notifications instead of email, and the same Tzelem UI as לוגיסטיקה and דוח 1.

## Goals

1. Everything the old web app does, the new one does: החתמה, זיכוי, קליטה ראשונית, דוח צ׳, חיפוש צ׳, the per-company page with in-company holders, יומן, ניהול מלאי, ניהול צ׳, PDF/Excel exports.
2. At any moment the app answers: where is each צ׳ (מחסן / which פלוגה / ללא שיוך), which soldier in the company holds it, and when it was last seen.
3. Every soldier named in the module is a soldier from דוח 1's list — picked, never typed — so "what does this soldier hold" works across the hub.
4. ציוד משלים follows the תקן automatically when signing and returning, with the quantities per company and in the warehouse kept right.
5. A company can check its own equipment (דוח צ׳) from a phone in a few minutes; the department is notified when something wasn't found and sees who hasn't reported.
6. The app starts from the current sheet and is refreshed from it again and again while both run side by side.

## Non-goals

- Writing back to the Google Sheet, or a live link to Google.
- Email. Notifications are the app's push notifications.
- Saving exports to Google Drive. The old app had "שמור ל־Drive"; the platform has no Google Drive connection yet, so it is left for later.
- Creating or editing soldiers. דוח 1 owns `people`, as for לוגיסטיקה.
- Managing companies or users inside the module. Units and memberships stay in `/admin`.
- Sharing tables with לוגיסטיקה. Same shapes, separate tables: different department, different permissions, and kesher equipment is signed to a company.

## Anti-goals (would be a failure even if it works)

- A soldier's name typed as free text anywhere a soldier is meant.
- A company user sees which soldiers hold devices in another company.
- A sign or return leaves quantities half-written (serials moved, accessories not).
- ציוד משלים quantities in the app drift from what was actually signed, with no log row explaining it.
- The import silently drops sheet rows, silently links a holder to the wrong soldier, or stores the uploaded file.
- Access codes or the sheet's emails end up in the database.
- A push notification that contains a soldier's name.

## Users and roles

`packages/core/src/modules.ts` already lists `kesher` with `admin` and `user`. Keep the two roles; reword `user` ("צפייה, שיוך חותמים בפלוגה ודוח צ׳") and set `status: "live"` when it ships.

| Role | Scope (membership unit) | Can |
|---|---|---|
| `admin` — מנהל | battalion (null unit) | Everything: החתמה, זיכוי, קליטה, catalogue and תקן, quantities, fixing a צ׳'s location, import, settings, plus everything a user can do in every company |
| `user` — משתמש | battalion or a company | Read everything not personal (צ׳ list, locations, quantities, תקן). In their scope: holders, the company page, יומן rows, דוחות צ׳; **assign holders inside the company** and **file a דוח צ׳** |

- **Any number of users per company** (answered): each gets a kesher membership on the company unit. Kesher equipment is held by the company, not a platoon, so the kesher role picker in `/admin/users` offers battalion or a company only — a platoon-level kesher membership would see no kesher rows (they carry the company) and, through `people_select`, only its own platoon's soldiers.
- This matches the old app: there, even the "צפייה" role could assign holders and file a דוח צ׳ (`_can()` in `Code.js.txt`); only "מנהל" managed the main tables, and "החתמה" could sign. The old "החתמה" role maps to `admin`.
- A company-scoped `admin` membership gets no more than `user` in that company: signing moves equipment out of the battalion warehouse, so it needs a battalion-wide admin. `kesherAccess(s)` in `apps/web/src/lib/kesher/access.ts` exposes `isAdmin` (battalion) and the user's company scope, like `logisticsAccess`.
- Every change records who and when (`audit_log` triggers), and the readable history is `kesher_events`.

## Soldiers — from דוח 1's list (answered)

Every soldier in this module is a row of the shared `people` table, the list דוח 1 owns. No soldier name is typed.

- **חותם על הפלוגה** (החתמה, קליטה) and **מחזיק בתוך הפלוגה** (company page) are picked with a soldier picker: search by name or personal number, limited to soldiers of the chosen company (its subtree), active only. The picker is the logistics `PersonPicker` (`apps/web/src/app/(shell)/logistics/_components/person-picker.tsx`), moved to `apps/web/src/components/` and shared.
- **מחתים** (who performs a החתמה / זיכוי / קליטה) and **מי מדווח** (דוח צ׳) are the signed-in user, taken from the session — not typed, not picked. Their name in the log comes from `app_users` by trigger, as in `logistics_events_actor`.
- **Who returns** on a זיכוי is optional: a company-wide return needs no soldier (as in the old app); if given, it is picked.
- **תפקיד** and **מסגרת** stay text with suggestions (values already used in the company; for מסגרת the soldier's platoon name is the first suggestion). They describe the kesher job (קשר מ״פ, חפ״ק), which דוח 1 doesn't hold.
- A soldier the app doesn't have can't be chosen. The picker's empty state says "החייל לא ברשימת דוח 1 — יש להוסיף אותו בדוח 1".
- **When the soldier changes later** (moved to another company, or removed from the list) the holding stays — the device didn't move — and the overview's "דורש טיפול" lists it ("N צ׳ אצל חיילים שעברו פלוגה / הוסרו מהרשימה"), like logistics' "inactive holders with equipment". The company page shows those rows with a warning chip.
- Log rows keep a text copy of the soldier's name (`person_name`) next to `person_id`, so the history stays readable whatever happens to the soldier.

## Concepts

- **צ׳ (serial)** — one device with a number. Its **location** is the warehouse (`במחסן`), a company, or none (`ללא שיוך` — the sheet has a few; the overview flags them).
- **Two levels of "who signed"** — kept apart, because the sheet keeps them apart:
  1. **חותם על הפלוגה** — the soldier who signed for the device when it left the warehouse (the החתמה form's soldier + תפקיד; columns מי חתום / תפקיד in "פיזור צ כללי"). Set by החתמה, cleared by זיכוי.
  2. **מחזיק בתוך הפלוגה** — who holds it inside the company: soldier, תפקיד, מסגרת (columns G:I of each company tab). Edited on the company page by anyone covering that company. Never changes which company the צ׳ is on.
- **ציוד משלים** — counted, not numbered. A quantity per item per place (warehouse, each company), plus the brigade's receipt quantity (מלאי קבלות חטיבה) for comparison.
- **תקן** — for a parent item (serial or ציוד משלים), the ציוד משלים that goes with each unit. Cascades: a תקן line whose item has its own תקן adds that too (מגבר). Depth-limited; cycles rejected on save.
- **מלאי מחסן חלקי** — the old app has a mode where the warehouse's accessory counts are not trusted: signing doesn't check or deduct them and returns don't add back (`_partialStock()`, log text "(מלאי חלקי)"). Kept as one setting, `warehouse_tracked`. When off, the warehouse column is shown greyed with "לא מנוהל", and החתמה/זיכוי touch only company quantities.
- **דוח צ׳** — a company's visual check: a signed-in user ticks every צ׳ of the company they saw. Stored with its lines, so each צ׳ has "last seen on … by …" or "not found".

## Data

New file `packages/db/src/schema/kesher.ts`, exported from `schema/index.ts`; table migration `pnpm db:generate --name kesher`, security migration `kesher_security`. Soldiers are `people` rows and companies are `units` rows (`kind = 'company'`), never copied. Times are `timestamptz`, shown in Asia/Jerusalem. `normalizeSerial` / `searchKey` from `@gdud/core` are reused.

| Table | Columns (beyond `id`, `created_at`, `updated_at`) | Notes |
|---|---|---|
| `kesher_items` | `name` unique, `kind` enum `serial` \| `bulk`, `category` null, `brigade_qty` int null, `sort_order` | The catalogue: device types (710, אולר …) are `serial`; ציוד משלים are `bulk`. `brigade_qty` only for `bulk`. Name 1–80 chars. |
| `kesher_kit_items` | `parent_item_id` → items, `item_id` → items (`bulk` only), `qty` int 1–99, `sort_order` | unique (`parent_item_id`, `item_id`). A trigger rejects a child that isn't `bulk` and any cycle. |
| `kesher_serials` | `item_id` → items (`serial` only, restrict), `serial` text unique (normalized, `^[^[:space:]]{1,40}$`), `location` enum `warehouse` \| `company` \| `none`, `unit_id` → units null, `vehicle` text null (the sheet's האמר column), `notes` text null | check: `unit_id is not null` ⇔ `location = 'company'`; trigger: `unit_id` must be a `company` unit. `serial` and `item_id` never change (column grants) — delete + add instead. |
| `kesher_holders` | `serial_id` PK → serials (cascade), `unit_id` → units (copied from the serial by trigger), `signer_person_id` → people null (restrict), `signer_role` text null, `signed_at`, `signed_by` (actor), `holder_person_id` → people null (restrict), `holder_role` text null, `frame` text null | One row per צ׳ that is on a company. Created by החתמה / קליטה, deleted by זיכוי (the events keep the history). `signer_person_id` is null only for rows imported before דוח 1 had the soldier (see Import). A trigger checks, on insert and whenever a person column changes, that the soldier is active and in the company's subtree. Roles and frame ≤ 40 chars. |
| `kesher_stock` | `item_id` → items (`bulk`), `unit_id` → units null (null = warehouse), `qty` int | unique (`item_id`, `unit_id`) `nulls not distinct`. Company rows `qty >= 0`; the warehouse row may go negative only while `warehouse_tracked` is off. No row = 0. |
| `kesher_checks` | `unit_id` → units, `at`, `by_user` (actor), `reporter_name` (trigger, from `app_users`), `total`, `found`, `note` null, `notified_at` null, `sheet_key` null unique | A דוח צ׳ header. Append-only for users; `notified_at` is set only by the notification job (no grant to `authenticated`). Imported rows keep the sheet's reporter text in `reporter_name` and have no `by_user`. |
| `kesher_check_lines` | `check_id` → checks (cascade), `serial_id` → serials null (set null), `serial` text, `item` text, `found` bool | Text copies so the report stays readable after a צ׳ is removed. "Last check of a צ׳" = its newest line (index on `serial_id, check_id`); the builder may add a view. |
| `kesher_events` | bigserial `id`, `at`, `kind` enum, `actor_user_id` (actor), `actor_name` (trigger), `unit_id` null, `company` text, `person_id` → people null (set null), `person_name` null, `person_role` null, `item` null, `serial` null, `qty` int null, `details` null, `backdated` bool, `sheet_actor` null, `sheet_key` null unique | The יומן. Append-only. Kinds: `sign`, `credit`, `intake`, `assign`, `stock_edit`, `serial_edit`, `kit_edit`, `check`, `import`, `legacy` (sheet rows whose action text isn't recognised). One row per צ׳ and per ציוד משלים line, like the sheet's log. `sheet_actor` keeps the old log's typed "שם המחתים" for imported rows only. |
| `kesher_settings` | single row (`id = 1` check): `warehouse_tracked` bool default true, `check_stale_days` int default 7 | `check_stale_days` drives "ישן · N ימים" on the overview, the דוח צ׳ badge and the stale reminder. |

Plus one shared change for notifications: `doch1_push_subscriptions` becomes the platform's `push_subscriptions` (see Notifications).

`kesher_*` enums live next to the tables, their value lists in `packages/core/src/kesher.ts` (as `LOGISTICS_EVENT_KINDS` does), together with the pure helpers: `expandKit(counts, kits)` (the cascade, depth ≤ 4), the Hebrew labels, and the check-status rule used by the overview chips (לא הוגש / N לא נמצאו / ישן / תקין).

## Security: grants, policies, triggers

All in `migrations/00NN_kesher_security.sql`, written like `0003_logistics_security.sql`; scope checks use the set form from `0010_rls_scope_sets.sql` (`unit_id = any(app.unit_scope('kesher'))` evaluated once per statement), not per-row `has_role()`.

**Company scope.** Kesher rows carry a company `unit_id`; memberships are battalion or company (see roles), so "members covering `unit_id`" below is `(select app.unit_scope('kesher')) is null or unit_id = any((select app.unit_scope('kesher'))::uuid[])`, as the 0010 policies are written.

| Table | select | insert / update / delete |
|---|---|---|
| `kesher_items`, `kesher_kit_items`, `kesher_settings` | any kesher member (`app.has_module('kesher')`) | battalion admin (`app.has_role('kesher', array['admin'])`) |
| `kesher_serials` | any kesher member — type, number, location and company are not personal | insert / delete / update (`location`, `unit_id`, `vehicle`, `notes`): battalion admin. Grants: `update (location, unit_id, vehicle, notes)` only. Delete blocked while a `kesher_holders` row exists (trigger, like `logistics_serials_delete_guard`). |
| `kesher_holders` | members covering `unit_id` | insert / delete: battalion admin. Update: members covering `unit_id`; a guard trigger lets non-admins change only `holder_person_id`, `holder_role`, `frame` (signer columns, `unit_id`, `serial_id` → admin only). |
| `kesher_stock` | any kesher member | battalion admin |
| `kesher_checks`, `kesher_check_lines` | members covering `unit_id` (lines through their check) | insert: members covering `unit_id`; a line's `serial_id` must be a צ׳ on that company at insert time (trigger). No update/delete grants. |
| `kesher_events` | battalion members: all; company members: rows of their companies, plus rows with `unit_id is null` and no `person_id` (warehouse stock edits, catalogue changes) | insert: members (the action decides the kind); `actor_name` set by trigger. No update/delete. |

- **Reading soldiers.** `people_select` already lets any membership read the people of the units it covers (`app.unit_scope()` with no module), so a kesher company user sees their company's soldiers for the picker and the holder names, and nobody else's. Nothing new on `people`; kesher never writes to it.
- **The soldier check in triggers** needs a soldier's unit regardless of the caller's own visibility. `app.person_unit()` (0003) answers only for logistics members; generalise it to "any module member" or add `app.kesher_person_unit()` — security definer, returns only the unit id.
- Triggers: `app.audit` on every table, `app.touch_updated_at` on the mutable ones, the guards above, and `kesher_holders.unit_id` copied from the serial on insert (so a holder row can never sit on a different company than its צ׳).
- No `anon` grants. No `systemDb()` in request code. The import runs as the admin through `withUser`. The notification job runs from the cron route like doch1's.
- RLS tests in `packages/db/test/rls.test.ts`, `describe("kesher")`: battalion admin; battalion user; company user (sees own holders, not another company's; can set a holder from their company, not one from another company and not an inactive soldier; can't change signer columns; can file a דוח צ׳ for own company only, not with a צ׳ from another company); two users of the same company see the same rows; user from another module (sees nothing); no membership. Plus: a company user can't change quantities or move a צ׳; a צ׳ on a company can't be deleted; a kit cycle is rejected; `notified_at` can't be set by a user.

## Writes (Server Actions)

Every action: `requireModule("kesher")` → `kesherAccess` / `can()` → zod → one `withUser(s.claims, tx => …)` transaction (RLS checks again) → events → `revalidatePath`. Errors come back as a list of Hebrew sentences that say which צ׳ / item / soldier and why, like the old app's `errors[]`. A date in the past is allowed on החתמה / זיכוי / קליטה (`at` = that date, `backdated = true`, shown "רטרואקטיבי" in the יומן); a future date is rejected.

- **החתמה** (`#/sign`, admin) — input: company, signing soldier (picked from that company) + role, date, notes, צ׳ ids, ציוד משלים lines `{item, qty, source: kit|manual}`. The מחתים is the signed-in user. Every צ׳ must be in the warehouse at commit time (re-read inside the transaction; a צ׳ someone else just signed → error naming it). Serials → `company`, a `kesher_holders` row with the signer (holder columns empty). Stock: company `+qty`; warehouse `−qty` when `warehouse_tracked`, and then a line above what the warehouse has is an error ("חורג מהמלאי" in the UI already). Events: one `sign` per צ׳ and per line.
- **זיכוי** (`#/credit`, admin) — input: company, צ׳ ids (must be on that company), ציוד משלים lines (each ≤ what the company has), optionally the returning soldier, notes. Serials → `warehouse`, holder rows deleted. Stock: company `−qty`; warehouse `+qty` when tracked. The UI proposes accessory quantities from the תקן of the chosen צ׳, capped at what the company has.
- **קליטה ראשונית** (`#/intake`, admin) — input: company or the warehouse, signing soldier (required for a company), rows `{item, serial}`, optional pasted list. Each serial must not exist yet (error names the existing one and where it is). Creates the serials (and a holder row when on a company). ציוד משלים from the תקן is added to the company **without** touching the warehouse and without a stock check — same as the old `_waIntake` (`_writeKlali(…, false)`).
- **שיוך בתוך הפלוגה** (company page, user or admin covering the company) — input: company, rows `{serial_id, holder_person_id | null, holder_role, frame}`. Each צ׳ must be on that company and each soldier active in it. One `assign` event per changed row. Group edit and "מילוי לכולם" (one soldier for the whole group) are UI only.
- **דוח צ׳** (`#/check`, user or admin covering the company) — input: company, note, the ids seen; the reporter is the signed-in user. The server builds the lines from the company's צ׳ at commit time (a צ׳ moved meanwhile isn't in the report; one added meanwhile counts as not found and the result says so). One `check` event with the counts. Notification: see below.
- **ציוד משלים — כמויות** (`#/stock`, admin) — one column at a time (warehouse or a company), as in the mockup and the old `wa_stockSave`. One `stock_edit` event per changed cell with before → after.
- **תקן** (`#/stock`, tab תקן, admin) — add / remove / change lines. `kit_edit` events.
- **ניהול צ׳** (inspector on `#/serials`, admin) — move location as a correction (logged as `serial_edit`, not as a sign/return, and the UI says so), notes, vehicle, remove (only when not on a company). Item type and number never change.
- **Settings** (admin): `warehouse_tracked`, `check_stale_days`, catalogue (add item, rename, category, kind, brigade qty). A small `/kesher/settings` page; not in the mockup, plain Tzelem form rows.

## Notifications (answered: the app's push, no email)

The platform already sends web push for דוח 1 (VAPID, `web-push`, a `CRON_SECRET`-protected route called every 5 minutes by Supabase `pg_cron`). Kesher uses the same system:

- **Shared subscriptions.** Rename `doch1_push_subscriptions` → `push_subscriptions` (same columns and owner-only policies), move `push.ts` and the push toggle out of `doch1/` into shared places. One subscription per device serves every module. A migration renames the table; doch1 code follows.
- **Who gets what:**
  - **דוח צ׳ with צ׳ not found** → every battalion kesher admin: "דוח צ׳ · פלנ״ט · 3 לא נמצאו" → opens the company page.
  - **Stale reports** (none, or older than `check_stale_days`) → once a day, the kesher users of that company: "דוח צ׳ · פלנ״ט · עברו 9 ימים מהבדיקה האחרונה" → opens `#/check` for the company. Daily time in `kesher_settings` (default 09:00, off allowed).
- **How it's sent.** The scheduled job (`/api/doch1/cron` generalised to `/api/cron`, running each module's job) picks up `kesher_checks` with missing items and `notified_at is null`, sends, and sets `notified_at`; the stale reminder keeps a per-company "last sent" day. Sending never happens inside the user's request, so a company user never reads other users' subscriptions.
- **Payloads** carry company names and counts only — never a soldier's name or a צ׳ number (same rule as doch1).
- The kesher app shows "הפעלת התראות" (the shared toggle) on the overview for admins and on the דוח צ׳ page for company users, with the iPhone "Add to Home Screen" note doch1 already has.

## Screens

Layout per the mockup: `apps/web/src/app/(shell)/kesher/layout.tsx` renders `<AppShell>` with name "מחלקת קשר", sub "פיזור צ׳, החתמות ומלאי", mark icon `antenna`, sidebar search → `/kesher/serials?q=`, current = `tinted` (like לוגיסטיקה). Routes follow the mockup's hash routes. Every page starts with `requireModule("kesher")`; admin-only pages redirect a user to the overview. `loading.tsx` with `<PageLoading>`. Desktop first for admin pages, phone first for the company page and דוח צ׳. Soldiers are shown as name + platoon (`PersonBadge` style); personal numbers via `<Serial>` where shown.

Nav (mockup sidebar): **סקירה** `/kesher` · **פלוגות** `/kesher/companies/[unit]` · **צ׳ במערכת** `/kesher/serials` · **ציוד משלים** `/kesher/stock` · **יומן** `/kesher/log` — then group **פעולות** (only items the user may use): **החתמה** `/kesher/sign` · **זיכוי** `/kesher/credit` · **קליטה ראשונית** `/kesher/intake` · **דוח צ׳** `/kesher/check` (badge = companies in scope without a fresh report) · **ייבוא מהגיליון** `/kesher/import`. Bottom: **הגדרות** (admin). Phone tabs: סקירה, פלוגות, צ׳, דוח צ׳, עוד.

What a company user sees: the same nav minus admin actions; פלוגות opens on their company and the pills show only companies in scope; the overview's company table shows all companies' counts (not personal) but report details and holders only for theirs.

1. **סקירה** (`#/home`) — header actions דוח צ׳ / זיכוי / החתמה (by permission). Panel "פיזור הצ׳": bar + KPIs במחסן / על הפלוגות / ללא שיוך / נראו בעין ב־N ימים. Table of companies: צ׳, משויכים בפלוגה (meter), last דוח צ׳ chip + date, ציוד משלים total. "חתימות אחרונות" (8 events) → יומן. Side: "דורש טיפול" (ללא שיוך; per company: no report / missing in last report / stale; holders who left the company or the list; holdings imported without a soldier), "ציוד משלים בחוסר במחסן" (warehouse qty ≤ 1, hidden when not tracked), "הפקת דוחות".
2. **פלוגה** (`#/companies/<unit>`) — company pills with counts; header with "רשימת ציוד להדפסה" and "החתמה לפלוגה" (admin; opens החתמה with the company chosen). Last-report strip with the missing צ׳ and "דוח צ׳ חדש". Segmented: **צ׳** — table grouped by device type with done/total per group, inline row edit (pencil → soldier picker + תפקיד + מסגרת + save/cancel), group edit with "שמירת הקבוצה (N)" and "מילוי לכולם", changed rows tinted, a warning chip on holders no longer in the company; **ציוד משלים** — חתומים / לפי תקן / פער per item.
3. **צ׳ במערכת** (`#/serials`) — search (צ׳, device, holder name, frame — holders only in scope) and pills הכל / במחסן / בפלוגות / ללא שיוך / לא נמצאו בדוח; table; inspector panel (side on desktop, sheet on phone) with details, admin fixes and the צ׳'s history (its events + check lines). Replaces both חיפוש צ׳ and ניהול צ׳.
4. **ציוד משלים** (`#/stock`) — segmented **מלאי לפי פלוגה** (items grouped by category × warehouse + companies, total, brigade qty with "מעל" when we hold more than the brigade receipt; admin "עדכון כמויות" picks one column to edit) and **תקן ציוד משלים** (cards per parent item, steppers for admin).
5. **יומן** (`#/log`) — segmented **יומן חתימות** / **דוחות צ׳**; search, company and action filters; paged (the old app showed the last 400 — here 100 per page with "הקודמים"). Excel export of the filtered rows.
6. **החתמה** (`#/sign`) — three steps like logistics' sign-out: 1 company + signing soldier (picker, limited to the company) + role + date — the מחתים line shows the signed-in user, read-only; 2 warehouse צ׳ grouped by device type, collapsible, pills to pick, search by digits; 3 the cart: chosen צ׳, ציוד משלים filled from the תקן ("תקן" / "ידני" chip, stepper, "חורג מהמלאי"), add an item by hand, notes, the button disabled with "חסר: …" until complete. After saving → the company page with a toast. A draft of an unfinished form is kept per device in `localStorage` (the old app did this; it matters on a phone in the field), cleared on save.
7. **זיכוי** (`#/credit`) — company pills; 1 the company's צ׳ grouped by type (holder name on hover / long-press), "סימון הכל" per type; 2 accessories with steppers capped at the company's quantity, proposed from the תקן; 3 summary, optional returning soldier (picker), notes, "זיכוי והחזרה למחסן".
8. **קליטה ראשונית** (`#/intake`) — 1 company or warehouse + signing soldier (picker); 2 rows of (device type, צ׳) with an inline "already exists" error, "הדבקת רשימה" (one צ׳ per line, same type); 3 summary + the תקן preview and the note that ציוד משלים doesn't come out of the warehouse.
9. **דוח צ׳** (`#/check`) — without a company: list of companies in scope with their status. With one: company pills, groups by device type with "סימון קבוצה", one large checkbox row per צ׳ (holder · role · frame; "לא נמצא בפעם הקודמת" chip), a note card that shows "מדווח: <signed-in user>", a sticky bar with progress and "שליחת הדוח", a confirm that states how many weren't found and that the department will be notified. Ticks survive a reload (draft in `localStorage`).
10. **ייבוא מהגיליון** (`#/import`) — see Import.
11. **Exports** (dialog in the mockup): **פיזור צ׳ כללי** (all or one company / warehouse; PDF and Excel) and **רשימת ציוד פלוגתית** (a company's צ׳ grouped by holder, then ציוד משלים quantities, then a receipt line to sign — the old `wa_coReport`). PDF = a print-styled page and the browser's "save as PDF", as logistics' forms do; Excel = generated on the server from the same rows. The app has no Excel writer yet; `write-excel-file` is already in the lockfile (a dev dependency of `packages/db`), so moving it to `apps/web` passes `minimumReleaseAge`. No "שמור ל־Drive" (later, when the platform has a Drive connection).

The mockup's "לפי תקן / פער" numbers and the "מעל" flag are real features (computed as described); its dates and counts are not. Its typed-name inputs become pickers / the signed-in user as described above.

## Import from the sheet

The sheet keeps being updated while the app runs (answered), so the import is built for repeated refreshes, like logistics: `/kesher/import`, battalion kesher admin or super admin; upload the `.xlsx` (≤ 4 MB) downloaded from Google Sheets; choose tabs; preview grouped as **ישתנו** (ticked — the sheet wins), **חדשים** (ticked), **רק באפליקציה** (unticked — nothing removed unless ticked), **לא נקראו** (never imported, says what to fix); apply re-parses, checks the preview fingerprint, writes the ticked lines in one `withUser` transaction, and logs one `import` event. The file is parsed in memory and never stored; logs never contain cell values. Code in `packages/db/src/kesher-sheet/` (read → diff → apply), reusing the `.xlsx` reader (`packages/db/src/logistics-sheet/xlsx.ts`) and the preview UI (`apps/web/src/app/(shell)/logistics/import/change-table.tsx`, `import-flow.tsx`) — moved to shared places rather than copied.

While both run, the sheet is the record: a change made only in the app (e.g. a new holder) shows on the next import as **ישתנו** back to the sheet's value; the admin unticks it to keep the app's. The preview says this in one line above the list.

**Companies** are matched to `units` (kind company) by `searchKey` of the name (so `פלת"צ` = `פלת״צ`). An unknown company is "couldn't read" with "הפלוגה X לא קיימת — יש להוסיף אותה בניהול מערכת". Units are never created. **עיט is not a unit yet** (answered): add it in `/admin/units` before the first import, or its rows stay under "couldn't read". Serials are matched by `normalizeSerial`.

**Soldiers.** The sheet has names only. A name is matched to `people` by `searchKey` of the full name among the active soldiers of that row's company (subtree): one match → linked; none → "couldn't read" ("החייל X לא נמצא בפלוגה Y ברשימת דוח 1"); several → "couldn't read" listing the candidates with their platoon, and the admin can pick one in the preview (the choice applies to that file's import only). Never a fuzzy match. The holding line is separate from the serial line: a צ׳ whose holder can't be matched is still imported with its location; only its holder stays empty and appears in "דורש טיפול" until set by hand or by a later import. While דוח 1 covers only part of the battalion, expect many such rows; the preview groups them per name.

| Sheet tab | → | Key | Notes |
|---|---|---|---|
| פיזור צ כללי (header row 1, data from 2) | `kesher_items` (`serial`), `kesher_serials`, signer columns of `kesher_holders` | normalized צ׳ | A = device type (number-like types such as 710 read as text), B = צ׳, E = פלוגה (`במחסן` → warehouse, blank → none, else a company), G = מי חתום → `signer_person_id` (matched as above), F = תפקיד → `signer_role`, J = הערות → notes, K = האמר → vehicle. C (מדבקה) and D (מיקום) are empty today and not imported; H/I are formulas copying the company tabs — ignored. Device type differs from the app → "couldn't read" (type never changes by import, as in logistics). |
| each company tab (sheet named as the company; header row 2, data from 3) | holder columns of `kesher_holders` | normalized צ׳ (column F) | Only E:I are read: F צ׳, G חתום → `holder_person_id`, H תפקיד, I מסגרת. A–C (formula counts), J (סטטוס formula), K–N (checkbox, helper lists) are ignored. A צ׳ listed in a company tab that "פיזור צ כללי" puts elsewhere → "couldn't read" ("הצ׳ רשום על X ולא על Y"). Error values (`#N/A`, `#REF!`) are empty. |
| כללי (header row 2, data from 3) | `kesher_items` (`bulk`), `kesher_stock`, `brigade_qty` | item name (column C) | Company columns are found by header name, not position; `במחסן` → warehouse row. `מלאי כללי` (a sum) is not imported but compared: if it differs from the sum the app computes, the line gets a warning. Column N = מלאי קבלות חטיבה. Column A (קטגוריה) is `#REF!` today: categories are set in the app, an import never blanks them. The helper blocks to the right (P onward) are ignored. Blank quantity = 0. |
| תקן ציוד משלים (header row 2, data from 3) | `kesher_kit_items` | parent + child | B פריט אב, C ציוד משלים, D כמות ליחידה. A parent that is neither a device type nor a ציוד משלים, a non-integer quantity, or a cycle → "couldn't read". |
| יומן חתימות (header row 1) | `kesher_events` (kinds from the action text, unknown → `legacy`) | content hash → `sheet_key` | Columns: time, company, soldier, role, issuer, action, record type (צ׳ / משלים), item, צ׳, qty. The soldier name is linked to `person_id` when it matches exactly as above, and always kept as `person_name` (it's history). The issuer goes to `sheet_actor`. **Column K (בוצע ע״י — emails) is not imported.** Rows that are only a timestamp (the sheet has some) are skipped and counted. Add-only, like the logistics `לוג`. |
| דוחות צ׳ (header row 1) | `kesher_checks` | company + time → `sheet_key` | reporter text → `reporter_name`, total, found, note. Column D (email) and J (status text, derived) are not imported. The free-text "פירוט הלא־נמצאו" becomes lines with `found = false` when its צ׳ can be parsed. Add-only; imported checks are marked notified so the job doesn't push old reports. |
| בדיקות צ׳ (header row 1) | `kesher_check_lines` | צ׳ + date | Columns: צ׳, device type, company, date, checked by, status (`נמצא` = found). A צ׳ can have several rows; the old app shows the newest. Every row becomes a line, attached to the imported דוחות צ׳ row of the same company and time when there is one, else to a synthetic check "ייבוא · בדיקות צ׳" per company and date. Result: every צ׳ shows the same "last seen" as the sheet. |
| Not imported | — | — | הרשאות אתר (names, emails, **access codes** — replaced by hub memberships), טופס חתימה, Copy of טופס חתימה, טופס קליטה ראשונית, סינון יומנים (forms and filters that are screens now), זיכויים כלליים (empty), `__דוח_PDF_זמני`. Listed greyed on screen 1 with the reason. |

Tab dependencies: פיזור before the company tabs; כללי before תקן; serials before checks. Unticking a line another ticked line depends on turns the dependent line into "couldn't read" in the result, as in logistics.

No developer CLI for kesher; tests drive `read → diff → apply` directly with invented data, in `packages/db/test/import-kesher.test.ts` (including: unmatched and ambiguous soldier names, a soldier in another company, the unknown-company row, re-import of the same file finds nothing new).

## Phases

1. **Read-only on imported data** — schema + security + RLS tests, import, סקירה, פלוגות (read), צ׳ במערכת (read), ציוד משלים (read), יומן. The department compares the app with the sheet. Before it: add עיט as a unit.
2. **Daily work** — החתמה, זיכוי, קליטה, שיוך בתוך הפלוגה, דוח צ׳, quantities and תקן editing, ניהול צ׳, settings, exports, and the push notifications (shared subscriptions + the two kesher notifications). From here the app can replace the Apps Script site.
3. **Later** — "שמור ל־Drive" for exports once the platform has a Google Drive connection; "what does this soldier hold" across logistics and kesher on the soldier card.

## Security and privacy

- `docs/SECURITY.md` applies in full. The data: links between soldiers (from `people`) and the devices they hold, kesher roles and frames, device serial numbers, which company holds which device, and vehicle numbers (האמר). The module stores no personal numbers, phones or emails of its own; it reads `people` under the existing policy.
- **ביטחון מידע approval: yes (answered).** Recorded in `docs/SECURITY.md` → Approvals.
- Imports: admin only, size limit, parsed in memory, file not stored, no formulas evaluated (cached values only), emails and access codes skipped by design, soldier matches exact only.
- Push payloads: company names and counts only.
- The real `.xlsx` stays out of git (already covered by `*.xlsx`). Tests use invented data.

## Calls I made (check these)

1. **Two roles kept.** `user` may assign holders and file a דוח צ׳ in their scope (as the old "צפייה" could); signing, returns, intake and stock are battalion admin only. The old "החתמה" role becomes `admin`.
2. **Kesher memberships are battalion or company only** (no platoon level), since equipment is held by the company.
3. **Non-personal data is visible to every kesher member** (צ׳ locations, quantities, תקן), as in the old app where every code saw everything; soldiers, reports and log rows are scoped to the company.
4. **מחתים and מדווח are the signed-in user**, not a picked soldier — the person at the keyboard is the one doing it. The old log's typed issuer names are kept as history only.
5. **תפקיד and מסגרת stay text** (with suggestions): they are kesher jobs, not דוח 1 data.
6. **Holdings survive a soldier's move or removal** and are flagged, not deleted.
7. **Imported soldiers: exact name match within the company only**; anything else waits for a person to decide.
8. **`warehouse_tracked`** replaces the old partial-stock switch, as one setting instead of a hidden config.
9. **Location fixes are separate from sign/return** and logged as `serial_edit`, so the יומן never shows a "sign" nobody did.
10. **Push subscriptions become shared** (renamed from doch1's table) rather than a second kesher table, so one device subscription serves every module.
11. **Drafts in `localStorage`** for החתמה and דוח צ׳ only. Cleared on save.

## Answered (2026-10-27)

1. **ביטחון מידע** — approved for the kesher data.
2. **Companies** — עיט is missing from `/admin/units`; the others exist.
3. **Side by side** — the sheet keeps being updated while the app runs; the import must stay safe to repeat.
4. **Users** — any number per company, each with a membership on that company.
5. **Soldiers** — linked to דוח 1's list; no free-text soldier names.
6. **Notifications** — the app's push notifications, no email.
7. **Drive** — not now; later when the platform supports it.

## Left to the builder

Exact column types and index choices within the table above, component breakdown, how the cart state is held, preview pagination, Excel layout details, the fingerprint function, the generalised cron route's shape, wording of individual error messages (Hebrew, specific, says what to fix), and whether the inspector on the phone is a sheet or its own route.
