# דוח 1 — operations

The daily personnel report module (`/doch1`). Design: `docs/superpowers/specs/2026-10-22-doch1-design.md`. Security rules: `docs/SECURITY.md`.

## What runs where

| Piece | Where |
|---|---|
| Pages and Server Actions | `apps/web/src/app/(shell)/doch1/` |
| Counting, dates and the lock rule, report texts | `packages/core/src/doch1/` (pure, unit-tested) |
| Tables | `packages/db/src/schema/doch1.ts` → `migrations/0004_doch1.sql` |
| RLS, grants, the lock guard (`GD001` locked day, `GD002` outside the round) | `migrations/0005_doch1_security.sql`, tested in `packages/db/test/rls.test.ts` |
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

Apply the two new migrations (`0004_doch1`, `0005_doch1_security`) with the usual command, from your machine (not Vercel):

```bash
pnpm db:migrate
```

Then Supabase → Advisors → Security Advisor should show no new warnings.

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

## Importing the round's Google Sheet

Battalion doch1 admin, `/doch1/import`:

1. In the sheet: File → Download → Microsoft Excel (.xlsx). Keep the file out of the repository (`*.xlsx` is git-ignored) and delete it when done.
2. Upload → "תצוגה מקדימה". Nothing is written yet. The preview lists the counts, warnings (rows without a personal number, a soldier in two tabs, values on days outside the round) and the round members that are not in the file (they are kept).
3. Answer the mapping questions: a tab → company or "להתעלם" (`גדודי` is a summary tab: ignore it); a platoon (מסגרת) → an existing unit, "ליצור מחלקה" (needs the core admin role too) or "ברמת הפלוגה"; an unknown status value → an existing status or "ליצור סטטוס". "עדכון תצוגה" until there are no questions. Answers are remembered for the next import of the round.
4. "ייבוא" runs everything in one transaction. Re-importing the same file changes nothing.
5. The first import creates statuses with flags from the sheet's `Dropdowns` groups and a grey color; go over them in הגדרות › סטטוסים (colors, display groups, `נספר בסד״כ`, `מעבר לגבול`).

The pilot rule: for a company with "דיווח באפליקציה מתאריך" set, the import never touches its day entries on or after that date (roster and enlistment fields still update).

## Pilot runbook (סבב 7, until 10.12.2026)

One company reports in the app; the sheet stays the official report.

Before the first day:

1. Set the environment variables, apply the migrations, schedule the cron (sections above). Deploy.
2. `/doch1/settings` → create the round (23.08.2026–10.12.2026), reminder 09:00, lock 10:00, brigade 10:15, active.
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

## Status changes during a round

Renaming a status, its color, group or order changes it in place. Changing a counting flag of a status that past days already use creates a new version from today on: past days keep counting with the old flags, today and planned days move to the new version.
