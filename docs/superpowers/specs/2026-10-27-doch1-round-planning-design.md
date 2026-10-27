# דוח 1 — round planning, arrival forecast and call-up day — design

Date: 2026-10-27 · Module id: `doch1` · Status: draft for approval

Builds on `docs/superpowers/specs/2026-10-22-doch1-design.md` (read it first) and implements its "Mode B — the people list", which was designed but never built. Operations as they are today: `docs/DOCH1.md`. Sheet layout: `references/doch1/sheet-structure.md`.

## Intent

Before every round, the battalion's doch1 office asks every soldier whether they plan to come, and writes the answer in the sheet's column I, "סטטוס הגעה על פי צפי גיוס" (צפי הגעה). Before that, the clerk gets the soldier list from the battalion and compares it to last round's list, to update the roster and to send corrections back to the battalion. On call-up day, the companies mark column K, "סטטוס גיוס" (התייצב, טרם התייצב, נדחה, שוחרר…), and the sheet's דוחות יום גיוס tab counts it for the brigade.

In the app today:
- A round is either `active` or not. There is no "next round being prepared" stage.
- צפי הגעה and סטטוס גיוס are free text on the round member (`doch1_members.arrival_forecast`, `enlistment_status`). They change nothing: a soldier who isn't coming still appears every day as a missing report from their call-up date, in the counts, and in reminders.
- The only way to start a round's roster is the sheet import (Mode A).

This change adds a **planning stage** to a round, the **battalion list comparison**, a **צפי הגעה with meaning** (a "not arriving" soldier is hidden for the whole round), and a **call-up day screen**.

## Goals

1. The clerk prepares the next round in the app while the current one is still running, without touching it.
2. The battalion's list is compared to last round's roster, the clerk decides each difference, and the corrections can be sent back to the battalion as a file.
3. Each company marks, for its own soldiers, who is coming. The battalion sees progress per company.
4. A soldier marked "not arriving" is not listed on any day of the round: not on the today screen, the board, any count, the reminders or the brigade report. They are still findable on a "לא מגיעים" list and can be brought back.
5. On call-up day the companies mark who showed up. The battalion sees counts and התייצב % per company and gets the brigade text, as the sheet's דוחות יום גיוס does.
6. No forecast or enlistment value is hard-coded. Both lists are defined in settings per round; behaviour comes from a flag on each value.

## Non-goals

- Asking soldiers directly (a form or a message to soldiers). The companies still collect the answers.
- Reading the battalion's personnel DB. The list comes as a file.
- Changing the pilot rule: during the pilot, **the sheet still wins**. A sheet import overwrites צפי הגעה and סטטוס גיוס of the round it imports into.

## Anti-goals

- Preparing the next round moves a soldier between companies in the current round.
- A soldier who was marked "not arriving" by mistake disappears and nobody can find them.
- Marking a soldier "not arriving" mid-round silently erases their reported days from the counts.

## Decisions (from the 2026-10-27 discussion)

| Question | Decision |
|---|---|
| What "not arriving" does | Hidden from every daily screen, count, reminder and report; shown on a "לא מגיעים" list and as a number on the overview |
| Who fills צפי הגעה | Company users for their own soldiers, and the battalion admin for everyone. Platoon commanders don't |
| Battalion list | An xlsx in the אלפון layout, compared to last round's members; each difference accepted or rejected |
| Planning stage | A round state: `בתכנון` → `פעיל` → `סגור` |
| צפי הגעה values | Defined in settings per round, each flagged "מגיע" or "לא מגיע" |
| Call-up day | In scope: a call-up day screen |
| Sheet vs app | The sheet still wins on import |
| In last round but not on the battalion list | Flagged; the clerk keeps or drops each one, and the difference goes into the corrections file |

## Round states

`doch1_rounds` gets a state: **בתכנון** (`planning`), **פעיל** (`active`), **סגור** (`closed`).

- At most one round is `active` and at most one is `planning` (partial unique indexes), so the next round can be prepared while the current one runs.
- The existing `active` boolean stays as a generated column (`state = 'active'`), so every existing read (`loadActiveRound`, the cron job, RLS helpers) keeps working unchanged. Only writes change.
- **New round** (settings, admin) is created in `planning`. It copies from the active round (else the latest one): companies (`doch1_round_companies`, with "פעילה בסבב" but not the pilot date), the current status versions (names, colors, flags, groups, sheet values), both value lists below, the שבצ״ק locations and standby types (per-round settings that carried-over soldier locations need), and the reports' דמ״ח categories and 10א groups; a status's camp points at the new round's location of the same name. Copying runs inside the same transaction; the admin edits afterwards.
- **"הפעלת סבב"** (admin, on the planning screen) closes the active round, makes the planning round active, and applies the pending unit moves (see "Moving soldiers between companies"). It's one transaction and asks for confirmation, listing what will happen: round X is closed, round Y opens on its start date, N soldiers change company.
- **Closing** a round without opening another is allowed (between rounds). **Reopening** a closed round is allowed when no other round is active. With no active round, a planning round can also be opened straight from settings (unless it has pending company moves). A planning round can be deleted.
- The daily screens (today, board, overview, brigade, copy, standby, reminders) keep working only on the active round. While a round is `planning`, only the planning screens and settings work on it.
- The database already blocks day entries outside a round's dates (`GD002`). Nothing new is needed to keep day entries out of a planning round, because no screen writes them; the sheet import still targets the active round only.

## Value lists: צפי הגעה and סטטוס גיוס

One settings table, `doch1_field_options`, holds both lists per round:

| Column | |
|---|---|
| `round_id` | |
| `field` | `arrival` (צפי הגעה) or `enlistment` (סטטוס גיוס) |
| `name` | the value as shown and as written in the sheet, 1–30 characters, unique per round and field |
| `effect` | what the value does (below) |
| `sort_order` | |

Effects (a check constraint pairs each effect with its field):

| Field | Effect | Means | Suggested values |
|---|---|---|---|
| arrival | `arriving` | listed in the round as usual | מגיע, מגיע חלקית |
| arrival | `not_arriving` | not listed on any day of the round | לא מגיע |
| enlistment | `arrived` | showed up; counts in התייצב % | התייצב |
| enlistment | `pending` | expected and not here yet | טרם התייצב, בדרך, פוטנציאל נפקד |
| enlistment | `postponed` | call-up moved; picking it asks for the new call-up date | תאריך גיוס נדחה, תאריך נדחה ביום גיוס |
| enlistment | `released` | released; picking it asks for the release date (default: that day) | שוחרר, שוחרר ביום גיוס |

- Settings › "צפי הגעה וסטטוס גיוס": add, rename, reorder, change effect, delete (deleting a value in use asks for a replacement value, or blank).
- The first time a round has no options, they're seeded from the distinct values its members already have (the free-text columns), all `arriving` / `pending`. The admin then sets the effects. The suggested values above are what the settings screen offers when the list is empty.
- Round members point at a value (`arrival_option_id`, `enlistment_option_id`) instead of holding text. The text columns are dropped after the backfill. "Blank" means not filled yet.
- A blank צפי הגעה counts as arriving. Only an explicit `not_arriving` value hides a soldier.

## Who is listed on a day

Today a soldier is listed from their call-up date through their release date (`inService()` in `packages/core/src/doch1/counting.ts`), and every screen, count and reminder goes through it. The rule becomes:

> Listed on a day = **not marked "not arriving"**, and from the call-up date through the release date.

Because every screen already goes through `inService()` / `inServiceBetween()`, putting the check there hides the soldier everywhere at once: today screen, board, overview, brigade report, שבצ״ק lists and readiness, "השלמת חסרים לפי אתמול", the reminders and the soldier card's 14 days. Copy-to-sheet keeps their sheet rows (the sheet still has them) without counting them as missing, as it already does for soldiers outside their dates.

"מגיע חלקית" needs nothing new: the soldier's call-up and release dates (already editable, and imported from column J) say which part.

**Where they are still found:**
- **חיילים** gets a "לא מגיעים" filter, which shows them with their צפי הגעה.
- **The overview** shows "לא מגיעים: N" per company and for the battalion, next to the counts (not inside them).
- **כרטיס חייל** still opens and shows a "לא מגיע בסבב" tag. "עריכה" changes the value back, and the soldier is listed again from their call-up date.

**Mid-round change.** Marking a soldier `not_arriving` while they have day entries in the round hides those days from every count, including past ones. The edit screen therefore checks first: if the soldier has reported days, it says "לחייל יש N ימי דיווח בסבב. לסמן תאריך שחרור במקום?" and offers to set the release date to yesterday instead (the right tool for someone who stopped coming). The admin can still choose "לא מגיע". The sheet import doesn't ask; its warnings list soldiers whose value became `not_arriving` while they have day entries.

## The battalion list (Mode B), during planning

**Screen:** `/doch1/planning/roster`, admin only.

**Input:** an xlsx (or csv) in the אלפון layout: שם מלא, מספר אישי, שם פרטי, שם משפחה, פלוגה, מחלקה, מקצוע, לכמה סבבים הגיע, מספר טלפון, גיל, האם קצין, תפקיד בפועל. Columns are matched by header (fuzzy, like the sheet import). Optional columns: צפי הגעה, תאריך גיוס. The file is parsed on the server in memory and not stored. It uses the same upload → phases → preview → apply flow as the sheet import.

**Compared against:**
- the **base round**: the active round, or the latest closed one if none is active (the screen names it and lets the admin pick another);
- and the planning round's own current members, so re-running with a corrected file shows only what's still different.

**Preview, per soldier (matched by מספר אישי):**

| Group | Means | Choices (default first) |
|---|---|---|
| חדשים | not in the system at all | add to the round / don't add |
| חוזרים | in the system, not in the base round | add / don't add |
| שינויים | in both; company, platoon, name, phone, תפקיד בפועל or officer flag differ | per field: take the battalion's value / keep ours |
| לא ברשימת הגדוד | in the base round, not in the file | keep in the round / drop |
| ללא שינוי | same | (added to the round, collapsed) |
| בעיות | no or bad מספר אישי, a soldier twice in the file, an unknown company or platoon | fix the mapping or skip |

Company and platoon names are mapped like the sheet import (an existing unit, or "ליצור"), and the answers are remembered for the planning round (`doch1_import_mappings`, the existing `company` and `platoon` kinds).

**Apply** (one transaction):
- people: create the new ones; update name, phone, תפקיד בפועל and officer flag where "take the battalion's value" was chosen;
- the planning round's members: every soldier kept or added. Carried over from the base round: תפקיד לדמ״ח, דיסקית, notes, שבצ״ק location. Call-up date: the round's call-up day, or the file's תאריך גיוס. צפי הגעה: blank, or the file's value mapped to the list (an unknown value is a question, like statuses);
- company and platoon moves: see the next section.

**"קובץ תיקונים לגדוד"** — an xlsx download of the decisions that disagree with the battalion's list: soldiers we kept who aren't on it, fields where we kept our value (both values shown), and soldiers on it we didn't add. That's the file the clerk sends back to the battalion.

**Without a file:** "העתקה מהסבב הקודם" adds every member of the base round to the planning round, carrying the same fields over. This is the fallback when the battalion's list is late.

## Moving soldiers between companies

`people.unit_id` is the soldier's current platoon and drives scope everywhere (RLS, logistics). If accepting a change from the battalion list moved it immediately, the soldier would jump company in the *running* round.

So:
- If the soldier **is not a member of the active round**, the move applies to `people.unit_id` right away.
- If they **are**, the new unit is stored on the planning membership (`doch1_members.planned_unit_id`) and applied by "הפעלת סבב". Until then the planning screens show the soldier under the new company with a "עובר מ־X" tag. Until activation the soldier stays in the old company's scope in RLS, so the battalion admin fills their צפי הגעה (the old company's user can too).

## Planning screen

**`/doch1/planning`** (admin and company users; it opens on the planning round, or says there is none and links to settings for the admin).

- **Admin:**
  - three steps with their state: 1. רשימת הגדוד (done / not yet, with the date of the last apply); 2. צפי הגעה (filled / total per company, and how many are coming / not coming / not filled); 3. הפעלת סבב (the button, with what it will do).
  - a "תזכורת" per company to fill צפי הגעה, using the existing reminder request queue with its own message ("פלס״ר · חסר צפי הגעה ל־12 חיילים").
- **Company user:** their soldiers in the planning round, grouped by platoon. Per soldier: a chip row of צפי הגעה values (colored by effect), call-up date, and notes. Filters: לא מולא / מגיעים / לא מגיעים. "סימון כל הלא מולאים כ־<value>" with an undo toast. Phone-first, like the today screen.
- Company users can't add or remove soldiers in a planning round. Roster changes go through the battalion list or the admin.

## Call-up day screen

**`/doch1/call-up`** on the active round. It opens on the round's call-up day until that day has passed, then on today, and takes `?day=`. Admin and company users; viewers read only.

- **Expected that day:** soldiers listed on that day (so not "not arriving") whose call-up date is on or before it, whose סטטוס גיוס is not `arrived` or `released`, plus everyone whose value was set that day.
- Per soldier: chips of the enlistment values. `postponed` asks for the new call-up date and moves `call_up_on`. `released` asks for the release date and sets `released_on`. Each choice shows an undo toast.
- **Summary per company and battalion:** count per value, expected, arrived, התייצב % (arrived ÷ expected, where expected leaves out postponed and released). It replaces the sheet's דוחות יום גיוס.
- **Brigade text:** a WhatsApp block like the sheet's (counts and %, no names), with copy and share buttons like the brigade report.

## Sheet import (Mode A) changes

- Columns I (צפי הגעה) and K (סטטוס גיוס) map to the two value lists. A value not in the list is a mapping question: map it to an existing value, or "ליצור" with an effect chosen in the question. Answers are remembered (new `doch1_import_mappings` kinds `arrival` and `enlistment`).
- **The sheet still wins:** each import sets both fields of the active round's members from the sheet, including blanks. Edits made in the app to those fields in the active round are overwritten. The planning round is never touched by the sheet import.
- Warnings: a soldier whose צפי הגעה is `not_arriving` but who has day entries in the sheet.

## Security

- `doch1_field_options`: RLS (select: anyone in doch1; insert/update/delete: doch1 battalion admin), grants, audit trigger, `touch_updated_at`, tests in `packages/db/test/rls.test.ts`.
- `doch1_members`: column grants for `arrival_option_id`, `enlistment_option_id`, `planned_unit_id`. The existing update policy (admin, company user in scope) is unchanged. A trigger checks that an option belongs to the member's round and its field (a composite FK `(round_id, arrival_option_id)` → `(round_id, id)` does the round part). `planned_unit_id` is writable by the admin only (trigger, like `doch1_member_location_guard`).
- `doch1_rounds.state`: written by the doch1 admin only (the existing rounds policies).
- RLS tests: a company user sets צפי הגעה for their own soldier in the planning round, but not for another company's soldier, and not `planned_unit_id`; a platoon commander can't set it; a viewer can't; an option of another round is rejected.
- The battalion file contains personal data (names, numbers, phones). It's parsed in memory and never stored, and the corrections file is generated on request and not stored. Same rules as the sheet import.

## Calls made in the design (check these)

1. **One table for both lists** with a `field` column, rather than two tables. Same columns and rules; it halves the RLS, audit and test work.
2. **Blank צפי הגעה = arriving.** Hiding needs an explicit "not arriving", so a forgotten field never makes a soldier vanish.
3. **The whole round is hidden, not single days.** "Partial" uses the existing dates.
4. **The base round for comparison** is the active one, falling back to the latest closed one.
5. **Pending company moves** wait for activation only for soldiers in the active round.
6. **Platoon commanders** don't take part in planning (they didn't fill this in the sheet either).
7. **Enlistment values with effects** were not asked about explicitly. The call-up screen needs to know which value means "arrived", "postponed" and "released", so the same settings-list approach as צפי הגעה is used.

## Open questions

- A sample battalion xlsx (fake data is enough), to confirm the layout matches the אלפון tab.
- The values the sheet uses today in column I, to make the suggested list match.
