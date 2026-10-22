# דוח 1 — design

Date: 2026-10-22 · Module id: `doch1` · Status: draft for approval

## Sources

- **Mockup** (source of truth for UI): `references/doch1/דוח 1 – אפליקציית מצבה.html`. The 13 screens, unpacked and readable, are in `references/doch1/mockup/NN.html` (+ `NN.css`, `app-tokens.css`); `mockup/INDEX.txt` names them. Below, "screen 07" means `mockup/07.html`.
- **Design decisions note:** `references/doch1/דוח 1 – אפליקציית מצבה החלטות עיצוב`.
- **The current Google Sheet:** `references/doch1/דוח 1 - סבב שביעי.xlsx` — real personal data, **must not be committed**. Its structure, formulas and quirks are written up in `references/doch1/sheet-structure.md`.
- **Patterns to copy:** the logistics module (`packages/db/src/schema/logistics.ts`, `migrations/0003_logistics_security.sql`, `apps/web/src/app/(shell)/logistics/`, `packages/db/scripts/logistics-import.ts`) and `docs/ADDING_A_MODULE.md`.

## Intent

The battalion runs דוח 1 — the daily status of every soldier — in a Google Sheet. Every morning the battalion chases companies for missing reports. The company clerk (רס"פ / clerk) is the bottleneck: they forget, the sheet is slow on a phone, and they wait for the company commander to tell them who is actually present and where.

דוח 1 in gdud-hub replaces the sheet with a phone-first app where the people who know (platoon commanders, the clerk) report directly, the day starts pre-filled, and the battalion sees completion live and gets the brigade report built for it.

We are mid-round (סבב 7, 23.08–10.12.2026). The first goal is a **pilot inside this round**: one company reports in the app while the sheet stays official.

## Goals

1. A company's daily report is complete by the lock time without anyone chasing it.
2. Platoon commanders update their own platoon; the clerk owns completeness for the company.
3. The battalion sees, live, who has reported and who hasn't, per company, and gets a brigade report (WhatsApp text) generated.
4. Everything the sheet computes — headcounts, reports, per-soldier day counts — the app computes the same way, so the pilot can be compared number for number.
5. No status, location, role category or standby-type name is hard-coded. All of them are defined in settings per round, and all calculations run off their flags.
6. The app can start mid-round by importing the current sheet (with history), and every future round starts by importing a people list.

## Non-goals (for now)

- Reading the battalion's main personnel DB directly (we have no access). Import is by file.
- Reading private Google Sheets through a Google account connection.
- Automatic WhatsApp sending (WhatsApp Business API). Reminders are app push notifications; the brigade report is copied/shared by a person.
- Replacing the sheet officially during the pilot.

## Anti-goals (would make it a failure even if it works)

- The clerk has to enter the pilot company's day twice (app + sheet) by hand.
- The app's numbers for the pilot company differ from the sheet's and nobody can tell why.
- A status word change next round requires a code change.
- Phone screens that are as slow or as fiddly as the sheet.

## Users and roles

Module roles (extend `packages/core/src/modules.ts`, which already lists admin / company_user / viewer):

| Role | Scope (membership unit) | Can |
|---|---|---|
| `admin` — מנהל גדודי | battalion (null unit) | Everything, all companies; edit any day including after lock; settings; imports; brigade report |
| `company_user` — משתמש פלוגה | a company | Own company: today's report, plan ahead, attendance board, soldier cards and roster edits (add soldier, move between platoons, enlistment fields), company standby teams and vehicles, copy-to-sheet |
| `platoon_commander` — מפקד מחלקה (**new**) | a platoon (unit under a company) | Own platoon only: today's statuses and the plan for coming days, soldier cards (read), "fill from yesterday" for the platoon |
| `viewer` — צפייה | battalion or company | Read-only overview and reports |

- Edits of today by company_user and platoon_commander are allowed until the lock time; after it, only admin. Future days (plan) are editable by both within scope at any time. Past days: admin only.
- Standby edit rights (from the design note, confirmed there): battalion-level teams (עתודת גדוד, פינוי, חפ"ק מג"ד/סמג"ד) — admin + the holding company; company teams (חפ"ק, כרמל, עתודה) — the company user. (Screen 05's table says "מנהל" only for חפ"ק מג"ד — the design note wins.)
- Every change records who and when (existing `audit_log` triggers). Two people editing the same soldier: last save wins; the soldier card's change log shows both.
- Users sign in with Google (existing invite-only flow). Platoon commanders and clerks are invited by email and given a membership on their unit.

## How it gets made

Built into the existing monorepo, following the existing patterns exactly: Next.js 16 on Vercel, Supabase Postgres with RLS, Drizzle, Tzelem (`@gdud/ui`, `tz-` classes), Hebrew RTL. Soldiers are the shared `people` table (`people.unit_id` = their platoon); units are the shared `units` tree (battalion → company → platoon). Every table gets RLS + grants + audit trigger + tests in `packages/db/test/rls.test.ts`. All dates/times are Asia/Jerusalem.

New things this module brings to the platform:
- **Web push** (PWA manifest + service worker + VAPID keys + a push-subscriptions table). On iPhone push works only after "Add to Home Screen", so the app shows an install prompt with instructions to company and platoon users.
- **A scheduler** for reminder/lock/send times. Times are settings (default 09:00 / 10:00 / 10:15), so the scheduled job runs frequently (e.g. every 5–15 minutes) and acts when a configured time has passed. Vercel Cron on the Hobby plan only runs daily — the builder must check the plan or use another trigger (e.g. Supabase `pg_cron` calling an endpoint). Lock does not need the scheduler to be exact: "locked" is computed from the current time vs the lock time at every write.
- **An in-app import pipeline** (upload → parse on the server → preview → confirm), used by both import modes. xlsx and csv; a published Google Sheet CSV link for the people list. The uploaded file is parsed in memory and not stored.

## Settings (admin) — the configurable core

Per round unless noted. Screen 05 (desktop) and 13 (phone) show the layout. Changes apply from today forward; days already reported keep the meaning they had (see "Status history" below).

1. **גדוד וסבב** — battalion name, full name for reports, color; round name, start, end; call-up day (the sheet counts presence from it — 06.09 this round); call-up hour and place; org days before call-up.
2. **דוח 1 היומי** — reminder time (09:00), lock time (10:00), brigade send time (10:15), "pre-fill from yesterday" toggle, second-reminder time (my call: optional, off by default).
3. **פלוגות ומסגרות** — companies (name, color, code, type, active this round) and their platoons/מסגרות (units). Attached forces (שריון 9מ, גששים, צמה) as companies flagged "מסופח" with service type and "included in reports". Per company: **"reported in the app from date"** (the pilot switch — see Pilot).
4. **סטטוסים** — name, color, group (for display), sort order, the **value written to / read from the sheet** (e.g. "0" for לא בשמ"פ), default location, and flags:
   - `counts_in_sadak` (נספר בסד"כ — used for בסד"כ headcount)
   - `counts_as_present` (sheet group שנספר — presence days)
   - `home_day` (sheet group רענון — home days, current רענון streak)
   - `org_day` (sheet group התארגנות — org-day entitlement)
   - `general` (sheet group כללי — total ימ"מ)
   - `off_duty` (sheet "0" and נפקד — not on active duty that day; not missing)
   - `across_border` (מעבר לגבול)
   - `needs_outpost` (must have an outpost in the שבצ"ק)
   - "leaving" and "returning" semantics for the tomorrow panel and the rotation cycle are expressed as flags too (`leaving_for_home`), not names.
   Seed for this round = the sheet's list: 0 (לא בשמ"פ), נפקד, רענון, התארגנות, יום התארגנות אחרון, עיבוד, עזה, שדה תימן, מיוערת, עורף, קורס, גימלים, רמ 2, יוצא לרענון, with flags from the sheet's groups and colors from the mockup (statuses the mockup lacks get the grey "other" color).
5. **מיקומים** — name, kind (outpost / camp / outside), which report column it feeds (15א outpost columns, 10א camp), holding companies. Seed: מוצב 131, מוצב 123, מחנה מיוערת, בחוץ.
6. **קטגוריות דמ"ח** — the critical-role report columns (קצין, מפקד זוטר, לוחם, מט"ב, חובש, נהג, גששים, תצפתניות, יתר) and the rule suggesting a category from מקצוע + "האם קצין" on import.
7. **גיוס והתייצבות** — the enlistment-status list (התייצב, טרם התייצב, תאריך גיוס נדחה, …, בדרך) and expected-arrival list (מגיע מלא, מגיע חלקי, …), each value flagged "expected to arrive" / "released" / "deferred" so the התייצבות card counts by flag.
8. **ימי התארגנות** — the entitlement table (defaults from the sheet: <10 → 0, ≤14 → 2, ≤28 → 3, ≤42 → 5, ≤56 → 7, ≥57 → 9) and the weekend rule (0 / 0.5 / 1).
9. **מחזורי רענון** — named rotation patterns, e.g. "7/1/4" = 7 × status A, 1 × status B, 4 × status C, chosen from the status list.
10. **כוננות ורכבים** — standby types (name, level battalion/company, size, required roles, holding companies, who edits) and the vehicle registry (number צ׳, type, state תקין/בטיפול/תקול).
11. **משתמשים והרשאות** — invite users and give memberships (reuses the platform's admin flow if it already covers module memberships).

### Status history (my call)

Reports and day counts must give the same answer for a past day after settings change. The builder chooses the mechanism; the requirement is: a status's flags as they were on day D are the ones used for day D. (Simplest acceptable: a status whose flags change gets a new version row effective from a date; day entries point at the version.)

## Data (conceptual — builder designs tables)

- **Round** — dates, settings above. One active round at a time.
- **Round member** — a person in a round: company/platoon for the round, תפקיד בפועל, מקצוע, דמ"ח category, service type, דיסקית, צפי הגעה, תאריך גיוס, סטטוס גיוס (+ date), notes, and the sheet row order (for copy-to-sheet). A person can be in many rounds; `people` holds the stable identity.
- **Day entry** — (person, date) → status, or nothing (= missing). Who and when. A day after today is a plan; when the day comes it is today's value. Plus a per-day שבצ"ק location (outpost/outside) — separate from status.
- **Standby team** — type, name, holding company(ies), location, vehicle, members (person + role), active.
- **Vehicle** — number, type, state.
- **Brigade report log** — time, sender, format, content.
- **Push subscription**, **reminder log**.
- `people.personal_number` (מספר אישי) is the match key for imports. ת"ז is not stored.

## Screens

Phone first for company and platoon users; desktop first for admin. Each mockup screen is a spec for layout and behavior.

### Phase 1 — pilot-critical

- **דוח 1 של היום** (screen 07) — company user sees the whole company grouped by platoon; platoon commander sees only their platoon. Status card (reported / total, missing chip, progress), "השלמת N חסרים לפי אתמול", search, filter (הכל / חסרים / by status group), soldier rows with status chip; tap → status sheet showing yesterday's status, statuses from settings as tiles; choosing saves and closes. Locked state after the lock time (read-only with a note "רק מנהל יכול לשנות"). Clerk also sees per-platoon completion.
- **עדכון קבוצתי** (screen 08) — multi-select soldiers → today / tomorrow / range → status; warns how many planned days it overwrites; undo toast.
- **Who must report today:** round members whose enlistment status is "expected/arrived" (not released/deferred) and whose day isn't `off_duty`. Missing = must report and has no entry today. Planned entries for today count as entered (see open question 1).
- **Admin overview** — desktop (screen 01) and phone (screen 06): KPIs, "where everyone is" bar, per-company table with completion %, "דורש טיפול" list. Phase 1 needs: KPIs, composition, per-company completion, missing list per company; standby tiles, 6-week chart and התייצבות card can come with their phases.
- **Reminder** — at the reminder time, push to every company_user and platoon_commander whose scope has missing soldiers ("פלסר · חסרים 9 דיווחים לדוח 1"). Admin can push a reminder to one company from the overview. Tapping opens דוח 1 של היום.
- **Brigade report** (screen 10) — WhatsApp text in the exact format of screen 10 (template in `references/doch1/mockup/10.html`), "(חלקי)" + warning when anything is missing, include toggles, copy / share; PDF and Excel later. During the pilot it is a preview only. Every send/copy is logged.
- **Copy to sheet** — for a company and a date: the day's sheet values (status "sheet value", empty for missing) in the company tab's row order, one per line, ready to paste into that day's column. Soldiers who were added in the app and aren't in the sheet are listed separately.
- **Current-sheet import** (admin) — see Import.
- **Settings needed for phase 1:** round, companies + platoons, statuses, report times, users. Soldier card read-only basics.

### Phase 2 — planning and the soldier

- **לוח נוכחות ותכנון** (screen 02) — soldiers × days grid, today highlighted, future days faded as plan, selection + bulk update, apply a rotation cycle with a per-soldier phase, side panel "today" and "tomorrow" (leaving / returning / arriving deferred).
- **כרטיס חייל** (screen 09) — today, 14-day strip, round stats (enlistment status, צפי הגעה, days served, home days, and the sheet's per-soldier numbers: current רענון streak, presence days, home %, org-day entitlement and remaining), details, change log, call / message.
- **Enlistment fields** — edited on the soldier card and in bulk from a list; התייצבות לסבב card on the overview.

### Phase 3 — שבצ"ק and standby

- Screens 03, 11, 12: team cards, quick "who is on which vehicle" view, locations in שבצ"ק, readiness (available = today's status in an "available" set defined in settings, default עזה + מיוערת; short when available < size or a required role is missing; full only if the vehicle is תקין), swap with candidates (same company, not on a team, same role first), status change from the team editor writes to today's דוח 1, undo, active toggle, vehicle registry.
- Per-soldier outpost assignment (מיקום בשבצ"ק).

### Phase 4 — reports and data checks

- Screen 04: R1 by מסגרת × מיקום with דמ"ח categories, סדיר / מילואים, across border; R2 15א by outpost; R3 10א camp; R4 מט"בים; R5 data checks; Excel export; the "סד"כ per מסגרת" table from the sheet.
- **Counting rule:** match the sheet (see `sheet-structure.md`, "Reports"): outpost rows count by שבצ"ק location, camp rows by status. Every disagreement between status and שבצ"ק is a data check (עזה without outpost, at an outpost but not עזה).
- Data checks run on every save: no status today; status but not in שבצ"ק; no enlistment forecast; in שבצ"ק but not in the round; עזה without location; duplicate מספר אישי.
- Attached forces included per their toggle.

### Phase 5 — the per-round people import

See Import. (Next round is a while away; the current-sheet import comes first.)

Mockup inconsistencies, builder's call: the two phone admin tab bars (06 vs 13) — pick one per role; mock numbers that don't add up across screens.

## Import

One in-app pipeline, admin only: upload → server parses → **preview** (new / updated / unchanged / problems) → admin fixes mappings → confirm → one transaction. Re-runnable and idempotent. Nothing is written until confirm. Report at the end (counts, skipped, warnings).

### Mode A — the current sheet (template "דוח 1 - סבב שביעי")

Input: the .xlsx export. Imports, for one round:
- round members from the company tabs (+ אלפון for מקצוע / האם קצין),
- every day cell → day entries (empty → nothing; "0" → the `off_duty` status mapped by sheet value; unknown value → preview problem with a "map to status" picker),
- enlistment fields (columns I/J/K/L),
- שבצ"ק: location, standby team, vehicle per soldier; standby teams and their vehicles from the side tables,
- attached forces as a current snapshot.
All tolerances in `sheet-structure.md` apply (number normalization, מסגרת spelling, header matching, dates from headers, the old פלתצ layout, duplicates reported not duplicated). Platoons are matched to settings by canonical name; unknown ones are mapped in the preview (and the mapping remembered). Companies are never auto-created.

**Pilot rule:** for a company with "reported in the app from date" set, re-import **does not touch day entries on or after that date** (roster and enlistment fields still update). Everything else is overwritten from the sheet on each re-import.

### Mode B — the people list (every round)

Input: xlsx / csv upload, or a published Google Sheet CSV link. Layout like the sheet's אלפון tab (שם מלא, מספר אישי, שם פרטי, שם משפחה, פלוגה, מחלקה, מקצוע, לכמה סבבים הגיע, מספר טלפון, גיל, האם קצין, תפקיד בפועל) — but columns are matched by header with a confirm/fix step, and the confirmed mapping is remembered. Optional columns: צפי הגעה, תאריך גיוס, סטטוס גיוס.
- Match by מספר אישי. Existing → update name, company, platoon, מקצוע, תפקיד בפועל, phone, officer flag; add to the round. New → create.
- דמ"ח category suggested from מקצוע + האם קצין; editable later.
- Not imported: גיל, לכמה סבבים הגיע (the app counts rounds itself).
- People from earlier rounds not in the file stay in the system but are not in this round.
- Fields the file lacks keep their current value.

## Pilot

- One company (admin picks) gets "reported in the app from date". Its platoon commanders and clerk are invited.
- That company reports only in the app; the clerk pastes the day into the sheet with copy-to-sheet.
- The other companies keep working in the sheet; the admin re-imports the sheet (Mode A) when they want the battalion views current.
- Reminders and lock run for real for the pilot company. The brigade report is a preview to compare with the sheet.
- Success (my guess, to confirm): the pilot company's report is complete by the lock time on most days without chasing; its numbers in the app match the sheet's; the clerk and commanders prefer the app.

## Security and privacy

- `docs/SECURITY.md` applies in full. New tables: RLS, explicit grants, audit trigger, RLS tests for admin / company user / platoon commander / other company / viewer.
- Platoon commander: RLS must limit writes to day entries of people in their platoon subtree, and to today-before-lock and future days.
- Lock enforcement is in the database (a write to today after the lock time by a non-admin is rejected), not only in the UI.
- Imports: admin only, size limit, server-side parsing, file not persisted, no formulas evaluated.
- The real .xlsx in `references/doch1/` must be excluded from git (add to `.gitignore`) or replaced by a scrubbed copy before the repo is pushed. Tests use invented data.
- Push payloads contain counts and company names only — no soldier names.

## Calls made in the design (check these)

1. **Shared tables.** `people.unit_id` is the soldier's *current* platoon and drives scope everywhere (RLS for platoon commanders, logistics visibility). The round member keeps a snapshot of company/platoon for that round's history. doch1 widens the shared `people` insert/update policies for doch1 `admin` (battalion) and `company_user` (own company subtree) — the same pattern `0003_logistics_security.sql` used for logistics admins. `units` and `memberships` stay writable by core admins only; the battalion doch1 admin is expected to also hold the core admin role for companies/platoons/users settings.
2. **Pilot roster.** During the pilot the sheet owns the roster for every company (the clerk keeps changing the roster in the sheet, as today); the app owns the pilot company's day entries from its pilot date. On re-import, a pilot-company soldier who disappeared from the sheet is not dropped — the preview lists them for the admin to decide. A soldier added only in the app is kept and shown in copy-to-sheet's "not in the sheet" list.
3. **Planned days count as reported** (see open question resolved below).
4. **Platoon commanders see only their platoon**; the clerk sees per-platoon completion.
5. Status history, statuses as per the sheet, counting as per the sheet — as written above.

## Answered

- **ביטחון מידע approval — approved.** The same operational data (outposts, per-soldier outpost assignment, standby readiness, vehicle numbers, 15א/10א) and real names and personal numbers are already held in the Google Sheet with approval; the approval carries over to this platform. Record this in `docs/SECURITY.md` as the explicit approval for doch1.
- **Pilot timing.** The pilot should run until the end of סבב 7 (10.12.2026). Phase 1 is the critical path and ships as early as possible; anything not needed for the morning loop and the sheet import (status versioning beyond the minimum, phases 2–5) must not delay it.

## Left to the builder

Table design, status-versioning mechanism, scheduler choice, xlsx library, how the shell nav and phone tab bars are arranged, component breakdown, test fixtures, PDF/Excel generation approach.
