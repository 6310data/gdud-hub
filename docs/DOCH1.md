# דוח 1 — operations

The daily personnel report module (`/doch1`). Design: `docs/superpowers/specs/2026-10-22-doch1-design.md`. Security rules: `docs/SECURITY.md`.

## What runs where

| Piece | Where |
|---|---|
| Pages and Server Actions | `apps/web/src/app/(shell)/doch1/` (the module's own frame: `layout.tsx` → `components/app-shell.tsx`) |
| Sheet import endpoint | `apps/web/src/app/(shell)/doch1/import/run/route.ts` — streams the import's phases (NDJSON, `lib/progress-stream.ts`) |
| Counting, dates and the lock rule, report texts, standby readiness | `packages/core/src/doch1/` (pure, unit-tested) |
| Tables | `packages/db/src/schema/doch1.ts` → `migrations/0004_doch1.sql`, `0007_doch1_standby.sql`, `0015_doch1_round_planning.sql`, `0017_doch1_drop_member_text_fields.sql` |
| RLS, grants, the lock guard (`GD001` locked day, `GD002` outside the round), the member guards (`GD003` a value of the other list, `GD004` a company move by a non-admin) | `migrations/0005_doch1_security.sql`, `0008_doch1_standby_security.sql`, `0016_doch1_round_planning_security.sql`, tested in `packages/db/test/rls.test.ts` |
| Round states, creating and activating a round | `packages/db/src/doch1-rounds/`, tested in `packages/db/test/doch1-rounds.test.ts`; settings actions `_actions/settings.ts` |
| תכנון סבב pages | `apps/web/src/app/(shell)/doch1/planning/` (actions: `_actions/planning.ts`; loaders: `apps/web/src/lib/doch1/planning.ts`, `roster.ts`) |
| Battalion list import (xlsx / csv → parse → compare → apply, corrections file) | `packages/db/src/doch1-roster-import/`, tested in `packages/db/test/doch1-roster-import.test.ts`; endpoints `planning/roster/run/route.ts`, `planning/roster/corrections/route.ts`; the comparison itself: `packages/core/src/doch1/planning.ts` |
| יום גיוס page | `apps/web/src/app/(shell)/doch1/call-up/` (counts and brigade text: `packages/core/src/doch1/call-up.ts`; action `setEnlistment` in `_actions/members.ts`) |
| כרטיס חייל | `apps/web/src/app/(shell)/doch1/soldiers/[personId]/` (loaders: `apps/web/src/lib/doch1/soldier.ts`; numbers and change-log text: `packages/core/src/doch1/soldier.ts`, `changes.ts`) |
| שבצ״ק וכוננות pages | `apps/web/src/app/(shell)/doch1/standby/` (actions: `_actions/standby.ts`; loaders: `apps/web/src/lib/doch1/standby.ts`) |
| Sheet import (xlsx → parse → plan → apply) | `packages/db/src/doch1-import/`, tested in `packages/db/test/doch1-import.test.ts` |
| Push sender + reminder job | `apps/web/src/lib/doch1/push.ts`, `reminder-job.ts`, endpoint `apps/web/src/app/api/doch1/cron/route.ts` |

The lock is enforced by the database: a write to today after the round's lock time (Israel time) by anyone but a battalion-wide doch1 admin is rejected, whatever the screen shows.

## Environment variables

Set them in the root `.env` for local development and in Vercel → Project → Settings → Environment Variables (Production) for the deployment. See `.env.example`.

| Variable | What |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web push public key (safe in the browser) |
| `VAPID_PRIVATE_KEY` | Web push private key — server only, never `NEXT_PUBLIC_` |
| `VAPID_SUBJECT` | `mailto:` address of the person responsible for the app |
| `CRON_SECRET` | Shared secret between the cron trigger and `/api/doch1/cron` |

Generate the VAPID pair once (keep it; changing it invalidates every subscribed phone):

```bash
pnpm dlx web-push generate-vapid-keys
```

Generate the cron secret:

```bash
openssl rand -hex 32
```

## Database

Apply the new migrations (`0004_doch1`, `0005_doch1_security`, and for שבצ״ק `0007_doch1_standby`, `0008_doch1_standby_security`) with the usual command, from your machine (not Vercel):

```bash
pnpm db:migrate
```

Then Supabase → Advisors → Security Advisor should show no new warnings.

Round planning (`0015_doch1_round_planning`, `0016_doch1_round_planning_security`, `0017_doch1_drop_member_text_fields`) goes out together with its code: the code reads the new columns, and 0017 drops the free-text צפי הגעה / סטטוס גיוס columns the old code reads. 0016 copies every value already in those columns into the round's lists (as מגיע / ממתין) before 0017 drops them.

## The reminder cron (runs on any Vercel plan)

Vercel Cron on the Hobby plan runs only once a day, so Supabase `pg_cron` calls the endpoint every 5 minutes. The job is idempotent: the daily reminder goes out once per user per day (a unique log row), and only between the reminder time and the lock time.

```sql
-- Supabase → SQL editor, once (replace the URL and secret; keep the secret out of git)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('doch1-reminders', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://<your-domain>/api/doch1/cron',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);
```

Check it by hand (returns `{"daily":…,"requests":…,"gone":…}`; without the header → 401):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/doch1/cron
```

To change the secret: update `CRON_SECRET` in Vercel, redeploy, then `select cron.unschedule('doch1-reminders');` and schedule again with the new value.

Who gets reminders: active users with a doch1 `company_user` or `platoon_commander` membership on a company (or a platoon under one) that is active in the round, who turned on "קבלת תזכורות" on the today screen. The message says only the unit and the count ("פלס״ר · חסרים 9 דיווחים להיום"). The "תזכורת" button on the overview queues a request that the next cron run sends. On iPhone, push works only after "Add to Home Screen" and opening the app from the icon; the today screen explains this.

The same cron run sends the "fill צפי הגעה" reminders of the round being planned (`runArrivalReminders()`, whether or not a round is active): the bell on the planning screen queues a request (`doch1_reminder_requests.kind = 'arrival'`), and the company's users get "פלס״ר · חסר צפי הגעה ל־12 חיילים".

## Importing the round's Google Sheet

Battalion doch1 admin, `/doch1/import`:

1. In the sheet: File → Download → Microsoft Excel (.xlsx). Keep the file out of the repository (`*.xlsx` is git-ignored) and delete it when done.
2. "בחירת קובץ" (or drag the file in) → "העלאה ותצוגה מקדימה". The screen shows each phase as it runs (upload, reading the sheet, matching). Nothing is written yet. The preview lists the counts, warnings (rows without a personal number, a soldier in two tabs, values on days outside the round) and the round members that are not in the file (they are kept).
3. Answer the mapping questions: a tab → company, "ליצור פלוגה" (a new company under the battalion, named after the tab; needs the core admin role too) or "להתעלם" (`גדודי` is a summary tab: ignore it); a platoon (מסגרת) → an existing unit, "ליצור מחלקה" (needs the core admin role too) or "ברמת הפלוגה"; an unknown status value → an existing status or "ליצור סטטוס"; an unknown צפי הגעה (column I) or סטטוס גיוס (column K) value → an existing value of the round's list, or "ליצור ערך" with its meaning (a round whose list is still empty takes every value in the file, as מגיע / ממתין). "עדכון תצוגה" until there are no questions. Answers are remembered for the next import of the round.
4. "ייבוא" runs everything in one transaction. The screen lists the phases (companies/platoons/statuses, soldiers, round members, day cells, saving the answers) with counts and the elapsed time; a first import can take a few minutes — keep the page open. If it fails, nothing is saved. Re-importing the same file changes nothing.
5. The first import creates statuses with flags from the sheet's `Dropdowns` groups and a grey color; go over them in הגדרות › סטטוסים (colors, display groups, `נספר בסד״כ`, `מעבר לגבול`, `זמין לכוננות`).
6. **שבצ״ק.** Each `שבצק <company>` tab belongs to the company its day tab was mapped to (a company answered "להתעלם", or not active in the round, is skipped with a warning). Sections and their repeated header rows are found by the "מספר אישי" header; columns by header text (מיקום, צ כלי, כוננות, תפקיד בפועל / תקן). A מיקום value is matched to a location of the round by name; an unknown one is a question — create it as מוצב / מחנה / בחוץ (the suggestion comes from the name), map it to an existing location, or don't import it — and the answer is remembered. What the import sets:
   - every soldier's location (a soldier of a company whose שבצ״ק was imported but who is in no שבצ״ק gets none);
   - the team of every soldier the שבצ״ק lists: one team per company and כוננות value, held by that company — an existing team of the round with that name held by it, else a new one (its standby type when one has the same name, its location the one most of its soldiers have); "לא בכוננות" = no team; a soldier on another team moves;
   - each team's members, their order and role (תפקיד בפועל in the שבצ״ק), and its vehicle when the sheet gives a צ׳ (a new צ׳ is added to the registry).

   Teams made in the app keep their soldiers who are in no שבצ״ק; a soldier the שבצ״ק lists in a company tab of no company is a warning. During the pilot the sheet's שבצ״ק wins for every company, the pilot company included: changes made to its teams in the app are overwritten by the next import.

The pilot rule: for a company with "דיווח באפליקציה מתאריך" set, the import never touches its day entries on or after that date (roster and enlistment fields still update).

צפי הגעה and סטטוס גיוס: the sheet wins. Each import sets both from columns I and K, a blank cell clears the value, and a soldier the sheet marks "not arriving" who still has days in it is a warning. The import always targets the active round; it refuses a round that is בתכנון.

## Pilot runbook (סבב 7, until 10.12.2026)

One company reports in the app; the sheet stays the official report.

Before the first day:

1. Set the environment variables, apply the migrations, schedule the cron (sections above). Deploy.
2. `/doch1/settings` → create the round (23.08.2026–10.12.2026), reminder 09:00, lock 10:00, brigade 10:15. It starts בתכנון; with no other round active, "הפעלת הסבב" in settings opens it.
3. `/doch1/import` → import the sheet (above). A company that is not part of this round but still has a tab (the hidden פלתצ): untick "פעילה בסבב" for it in settings right after the import (a soldier in both its tab and an active company's tab goes to the active company, and to a visible tab before a hidden one). Check the overview against the sheet's `דוחות` section B for the same day: rows, missing, on duty per company.
4. Released or deferred soldiers: on the today screen the clerk opens the soldier → "לא נספר בדוח" so they don't show as missing (and "החזרה לדוח" undoes it).
5. הגדרות › סטטוסים → review every status: color, display group, `נספר בסד״כ`, `לא בשמ״פ`, `מעבר לגבול`.
6. הגדרות › פלוגות ומסגרות → for the pilot company set "דיווח באפליקציה מתאריך" (the first day it reports only in the app).
7. `/admin` → invite the pilot company's clerk (doch1 role `משתמש פלוגה` on the company) and its platoon commanders (`מפקד מחלקה` on their platoon). Check each soldier sits in the right platoon unit — a platoon commander sees only the soldiers whose unit is their platoon.
8. Each of them opens `/doch1/today` on their phone and taps "קבלת תזכורות" (iPhone: Share → Add to Home Screen first, then open from the icon).

Every day:

- 09:00 — users with missing reports get a push. Platoon commanders and the clerk fill today (or "השלמת חסרים לפי אתמול").
- 10:00 — the day locks for everyone but the battalion admin.
- The clerk opens `/doch1/copy` (the pilot company, today) → "העתקה" → pastes into the sheet's company tab, in the day's column, at the row shown. Soldiers under "לא בגיליון" are added to the sheet by hand.
- The battalion admin compares `/doch1/brigade` with the brigade report sent from the sheet, and re-imports the sheet when the battalion views should show the other companies' current data (the pilot company's days from its pilot date are never overwritten).

Ending the pilot early: clear the company's "דיווח באפליקציה מתאריך" and re-import — the sheet becomes the only source again.

## שבצ״ק וכוננות (`/doch1/standby`)

Mockup screens 03 (desktop), 11 and 12 (phone). Everyone in doch1 opens it; a company user and a platoon commander see their company, the battalion admin and viewers see every company.

- **כוננות** — a card per standby team: holding companies, location, vehicle (צ׳), members with today's status, and readiness (`teamReadiness()` in `packages/core/src/doch1/standby.ts`). A member is available when today's status is marked "זמין לכוננות" in הגדרות › סטטוסים — no status name is hard-coded, so mark עזה and מיוערת (or this round's words) once. A team is short when fewer are available than its type's size (or its own member count, without a type) or a required role has no available member ("מ״פ / סמ״פ" = either); it is fit only when its vehicle is תקין. The side panel shows who is on which vehicle, soldiers per location, and the two checks: a status that needs an outpost without an outpost location, and an outpost location with another status.
- **מיקומים** — every soldier's location in the שבצ״ק (one or many at once, "בחירה"), filtered by location or by a check.
- **רכבים** — the state of the teams' vehicles (תקין / בטיפול / תקול).
- **Team editor** (`/doch1/standby/<team>`) — vehicle צ׳ (typing a new צ׳ adds it to the registry) and its state, location, members (add, remove, "החלפה" with candidates from the holding companies: available today first, same role first), type, name, active, and for the admin the holding companies. Changing a status here writes today's דוח 1, under the same lock as the today screen. Every change shows an undo toast.

Who edits a team: the battalion admin and the company users of its holding companies (a shared team like פינוי א has two). A company user creates teams for their own company only, can't add their company to another company's team, and adds only their own soldiers. Settings (admin): הגדרות › שבצ״ק, כוננות ורכבים — locations (kind מוצב / מחנה / בחוץ), standby types (level, size, required roles) and the vehicle registry, which is shared by all rounds.

**From the sheet:** the import reads every `שבצק <company>` tab (layout: `references/doch1/sheet-structure.md`, "שבצ״ק tabs") along with the company tabs — see "Importing the round's Google Sheet" below. A soldier's location is current, not per day.

## Call-up and release dates (`/doch1/soldiers`)

A soldier is listed on a day only from their **call-up date** (תאריך גיוס) through their **release date** (תאריך שחרור), inclusive (`inService()` in `packages/core/src/doch1/counting.ts`). A soldier with no call-up date is listed on no day. This applies to every screen and count: the today screen, the board (days outside the dates are blank cells), the overview, the brigade report, the שבצ״ק lists, "השלמת חסרים לפי אתמול" and the push reminders. Copy-to-sheet keeps those soldiers' sheet rows (with whatever value they have) but doesn't count them as missing.

The dates are set on `/doch1/soldiers` (company user or admin covering the soldier; one soldier, or several with "בחירה"). The sheet import fills the call-up date from column J; a blank J keeps the date entered in the app. The release date comes only from the app. Migration: `0012_doch1_service_dates` (`pnpm db:migrate`).

"לא נספר בדוח" (today screen) still works as before, on top of the dates.

**Not arriving.** A soldier whose צפי הגעה value means "לא מגיע" (הגדרות › צפי הגעה וסטטוס גיוס) is listed on no day of the round, whatever the dates — the same check in `inService()`, so every screen and count above follows. A blank צפי הגעה counts as arriving. They are still found: חיילים → "לא מגיעים", the overview's "לא מגיעים" column (next to the counts, not in them), and the soldier card. Their reported days stay in the database; switching the value back lists them again. A soldier who stops coming mid-round gets a release date instead (the soldier card offers it).

## כרטיס חייל (`/doch1/soldiers/<person>`)

Mockup screen 09. Opens from a row on חיילים, from "כרטיס חייל" in the today screen's status sheet (or the row itself once the day is locked) and from a name on the board. Anyone in doch1 who sees the soldier opens it (RLS: a platoon commander only their platoon).

- **Today** — the status and yesterday's, the שבצ״ק location, the standby team (a link to the team editor for who may edit it) and its vehicle, and the soldier's own data checks (outpost status without an outpost, an outpost with another status, no report yet). "שינוי סטטוס" uses the same sheet and lock as the today screen; "לא נספר בדוח" / "החזרה לדוח" for a company user or admin.
- **14 days** — a strip of the last 14 days with a count per status; days before the call-up or after the release are blank, not missing.
- **The round** — סטטוס גיוס, צפי הגעה, the dates, תפקיד לדמ״ח, and the sheet's per-soldier numbers (`soldierRoundStats()` in `packages/core/src/doch1/soldier.ts`, `sheet-structure.md` "Derived numbers"): presence and home days from the round's call-up day, home % (red above 55%), the current רענון streak, total ימ״מ (כללי, every שנספר status and רענון — not התארגנות), and ימי התארגנות entitled / used / left (the weekend rule: 0.5 back for one org day on Fri/Sat, 1 for two or more). All by flags; planned days don't count.
- **פרטים** — phone (התקשרות = `tel:`, הודעה = WhatsApp), דיסקית, notes, and the **change log**: every change to the soldier's days, round fields and people row, who and when. It comes from `audit_log` through `app.doch1_person_log()` (migration `0013_doch1_person_log`), which returns rows of one soldier the caller already sees — `audit_log` itself stays core-admin only.
- **עריכה** (company user or admin covering the soldier) — call-up and release dates, phone, תפקיד בפועל, תפקיד לדמ״ח (the values used in the round are suggested), צפי הגעה and סטטוס גיוס (picked from the round's lists), דיסקית, notes. Marking "לא מגיע" for a soldier who already has reported days asks first and offers a release date from yesterday instead (those days would drop out of every count). During the pilot the next sheet import overwrites these from the sheet (except the release date, and a blank call-up cell). A soldier marked not arriving gets a "לא מגיע בסבב" tag.

Migration: `0013_doch1_person_log` (`pnpm db:migrate`).

## Moving between days

The overview, the today screen, copy-to-sheet and the brigade report take `?day=YYYY-MM-DD` (inside the round) and show "יום קודם / יום הבא", a date picker and "היום". The board moves a week at a time. שבצ״ק וכוננות takes `?day=` too: availability, readiness and the status checks follow that day's report, while teams, vehicles and locations are always the current ones (they are not stored per day); the team editor works on today.

## Status changes during a round

Renaming a status, its color, group or order changes it in place. Changing a counting flag of a status that past days already use creates a new version from today on: past days keep counting with the old flags, today and planned days move to the new version.

## Round states

A round is **בתכנון** (`planning`), **פעיל** (`active`) or **סגור** (`closed`); at most one is active and one is being planned, so the next round is prepared while the current one runs. `doch1_rounds.active` is generated from the state.

- הגדרות › סבבים › "סבב חדש" creates the next round בתכנון and copies the active round's settings into it (the latest round's when none is active): the companies taking part (not the pilot date), the current statuses, the צפי הגעה / סטטוס גיוס values, the שבצ״ק locations and the standby types. The running round doesn't change.
- Settings edit the active or the planning round (a switcher at the top when both exist).
- "סגירת הסבב" closes the active round (the daily screens and reminders stop until another opens); "פתיחה מחדש" reopens a closed round while no other is active; a round בתכנון can be deleted (its soldiers' people rows stay).
- Activation: from תכנון סבב (below). With no round active, "הפעלת הסבב" in settings does the same.

## צפי הגעה and סטטוס גיוס values

הגדרות › צפי הגעה וסטטוס גיוס: two lists per round. A value has a name (as written in the sheet), a meaning and an order; behaviour comes from the meaning only:

| List | Meaning | What it does |
|---|---|---|
| צפי הגעה | מגיע | listed as usual |
| צפי הגעה | לא מגיע | listed on no day of the round |
| סטטוס גיוס | התייצב | counted in התייצב % |
| סטטוס גיוס | ממתין | expected, not here yet |
| סטטוס גיוס | נדחה | asks for the new call-up date |
| סטטוס גיוס | שוחרר | asks for the release date |

Deleting a value that soldiers have asks what they get instead (another value, or blank). An empty list offers suggested values.

## Planning the next round (`/doch1/planning`)

The menu shows "תכנון <round>" to the admin and company users while a round is בתכנון.

1. **The battalion's list** (admin, "השוואה לרשימת הגדוד" → `/doch1/planning/roster`). Upload the list the battalion sends — xlsx or csv in the אלפון layout (שם מלא, מספר אישי, פלוגה, מחלקה, מספר טלפון, תפקיד בפועל; optional צפי הגעה, תאריך גיוס). Columns are found by header. It is compared with the active round (or the latest; another can be picked), and once the planning round has soldiers, with them — so a re-run shows only what is still different. Answer the questions (an unknown company → one of ours or ignore; platoon → one of ours, create, or company level; צפי הגעה → a value or create one), then decide:
   - **שינויים** — per soldier and field (name, company / platoon, phone, תפקיד בפועל): the battalion's value or ours. A company move of a soldier in the running round waits for the activation ("המעבר יחול בהפעלת הסבב"); anyone else moves right away.
   - **חדשים**, **חוזרים מסבב קודם** — add to the round or not.
   - **לא ברשימת הגדוד** — keep in the round or not.

   "שמירה בסבב" writes it in one transaction (new soldiers are created; kept soldiers bring their תפקיד לדמ״ח, דיסקית, notes and שבצ״ק location; the call-up date is the file's or the round's). "קובץ תיקונים לגדוד" downloads the disagreements as xlsx to send back. The file is read in memory on every request and never stored. Without a list: "העתקה מהסבב הקודם" on the planning screen.
2. **צפי הגעה.** Each company user marks their soldiers (chips per value, a call-up date per soldier, "סימון N הלא מולאים כ־…", undo); the admin sees progress per company and can send a reminder (the bell). A blank value counts as arriving.
3. **הפעלת הסבב** (admin). The first tap lists what happens (the round that closes, the soldiers, the company moves, how many have no צפי הגעה); the second runs it: the active round closes, this one opens, and the waiting company moves apply — one transaction (`activateRound()`).

## יום גיוס (`/doch1/call-up`)

Per company and battalion: expected (called up by that day and arriving, minus נדחה and שוחרר), arrived, not yet (including not marked), postponed, released, התייצב %. It replaces the sheet's `דוחות יום גיוס`. The admin gets the brigade block (counts only) to copy or share. The admin and company users mark each soldier's סטטוס גיוס: נדחה asks for the new call-up date (the soldier leaves the daily screens until then), שוחרר for the release date — saved together, with undo. It opens on the round's call-up day until it has passed, then today; `?day=` picks another.
