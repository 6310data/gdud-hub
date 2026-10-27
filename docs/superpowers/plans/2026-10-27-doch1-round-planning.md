# דוח 1 — round planning, arrival forecast and call-up day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A round can be prepared in a `planning` state while another is active: the battalion's list is compared to last round's roster, companies fill צפי הגעה from a settings-defined list, a "not arriving" soldier is hidden from the whole round, activation applies pending company moves, and a call-up day screen tracks סטטוס גיוס.

**Architecture:** Round state on `doch1_rounds` (with `active` kept as a generated column so reads don't change). One settings table `doch1_field_options` for both value lists, referenced by the round member. The hiding rule goes into `inService()` / `inServiceBetween()` in `@gdud/core`, so every screen that already uses them follows. Pure logic (roster diff, call-up summary, brigade text) lives in `@gdud/core`. The battalion-list importer lives in `@gdud/db/doch1-roster-import`, shaped like `doch1-import` (read → parse → plan → apply). Pages are under `apps/web/src/app/(shell)/doch1/planning/` and `…/call-up/`.

**Tech Stack:** As in `docs/superpowers/plans/2026-10-22-doch1-phase1-pilot.md`: Next.js 16, Supabase Postgres + RLS, Drizzle 0.45, PGlite + Vitest, zod 4, Tzelem, `exceljs` (already in `packages/db`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md` (read it first), then `docs/superpowers/specs/2026-10-22-doch1-design.md` and `docs/DOCH1.md`.

## Global Constraints

- Read `CLAUDE.md`, `docs/SECURITY.md`, `docs/ADDING_A_MODULE.md` before Task 1.
- Hebrew RTL, Tzelem `tz-` classes, no new colors (effect colors use existing tokens: arriving/arrived = success, not arriving/released = muted, pending = warning, postponed = info). Personal numbers and phones: `<Serial>`.
- Every request data access: `withUser(session.claims, tx => …)`. Never `systemDb()` in pages or actions.
- Every page: `requireModule("doch1")`, then `can()`. Mutations: `can()` → zod → `withUser` write.
- New table: `.enableRLS()`, policies, explicit grants, `app.audit()`, `app.touch_updated_at()`, tests in `packages/db/test/rls.test.ts`.
- **No value name in code.** Behaviour reads `effect` from `doch1_field_options`. Suggested names (מגיע, לא מגיע, התייצב…) appear only as the settings screen's "empty list" suggestions and in the importer's header aliases.
- The sheet import keeps targeting the active round only and never touches a planning round.
- Never commit real files (`references/doch1/*.xlsx`, any battalion list). Tests use invented data.
- Done = `pnpm test && pnpm typecheck && pnpm lint` green.

## Review Focus

1. **`active` as a generated column.** After migrating, every existing read of `rounds.active` and the `doch1_rounds_one_active` index behave as before. Writing `active` directly fails. Test in Task 1 (PGlite: insert two rounds `state='active'` → unique violation; `update … set active = true` → error).
2. **A not-arriving soldier is gone from every count, but their data isn't lost.** `inService` returns false; their day entries stay in the table; switching back lists them again. Test in Task 2 (core) and Task 4 (a loader-level test, members → `listedOn`).
3. **Pending company move.** Accepting a company change for a soldier who's in the active round must not change `people.unit_id` before activation. Test in Task 7 (apply → `people.unit_id` unchanged, `planned_unit_id` set) and Task 9 (activate → moved, `planned_unit_id` cleared).
4. **Option from another round or the wrong field.** Rejected by the database, not only the form. Test in Task 1 (RLS/trigger tests).
5. **Activation is atomic.** Closing the active round, opening the planning round and applying moves happen in one transaction; a failure leaves both rounds as they were. Test in Task 9.

---

### Task 1: Database — round state, value lists, member columns

**Files:**
- Modify: `packages/db/src/schema/doch1.ts` (`doch1Rounds`, `doch1Members`, `doch1ImportMappings`, `doch1ReminderRequests`, new `doch1FieldOptions`)
- Create: `packages/db/migrations/0015_doch1_round_planning.sql` (generated, then hand-edited for the generated column)
- Create: `packages/db/migrations/0016_doch1_round_planning_security.sql` (hand: backfill, RLS, grants, triggers)
- Modify: `packages/db/test/rls.test.ts` (new `describe("doch1 round planning")` inside `describe("doch1")`)

**Interfaces produced:**
- `doch1_rounds.state text not null default 'planning' check in ('planning','active','closed')`; `active boolean generated always as (state = 'active') stored`; unique partial indexes `doch1_rounds_one_active` (kept) and `doch1_rounds_one_planning`.
- `doch1_field_options(id uuid pk, round_id uuid fk cascade, field text, name text, effect text, sort_order int, created_at, updated_at)`; unique `(round_id, field, name)`; unique `(round_id, id)` for composite FKs; check `(field = 'arrival' and effect in ('arriving','not_arriving')) or (field = 'enlistment' and effect in ('arrived','pending','postponed','released'))`; check `length(name) between 1 and 30`.
- `doch1_members`: `arrival_option_id uuid`, `enlistment_option_id uuid` (each a composite FK `(round_id, x)` → `doch1_field_options(round_id, id)`, on delete set null on the column only — use a trigger if Postgres 15 `ON DELETE SET NULL (col)` isn't available in PGlite), `planned_unit_id uuid fk units on delete set null`.
- `doch1_import_mappings_kind` check adds `'arrival'`, `'enlistment'`.
- `doch1_reminder_requests.kind text not null default 'report' check in ('report','arrival')`.
- The old `arrival_forecast` / `enlistment_status` text columns stay in this task (dropped in Task 5 after the import stops writing them).

- [ ] **Step 1: Write the failing RLS tests** (reuse the `doch1` describe's fixtures: battalion admin, `plsr` company user, platoon commander, viewer, another company's user):
  - admin creates options for a round; a company user can read but not insert/update/delete them;
  - a company user sets `arrival_option_id` for their own soldier; not for another company's soldier; a platoon commander and a viewer can't;
  - an option of another round → error; an `enlistment` option in `arrival_option_id` → error (`GD003`, see Step 4);
  - a company user can't set `planned_unit_id` (`GD004`); the admin can;
  - two rounds with `state='active'` → unique violation; two `planning` → unique violation; `update doch1_rounds set active = true` → error;
  - an audit row is written for an option insert.
- [ ] **Step 2:** Run `pnpm --filter @gdud/db test` → the new tests fail.
- [ ] **Step 3: Schema + generated migration.** Edit `schema/doch1.ts`, then run `pnpm --filter @gdud/db generate`. Hand-edit `0015` for the rounds change, in this order: add `state` (default `'planning'`); `update doch1_rounds set state = case when active then 'active' else 'closed' end`; drop index `doch1_rounds_one_active`; drop column `active`; add `active boolean generated always as (state = 'active') stored`; recreate `doch1_rounds_one_active`; create `doch1_rounds_one_planning`. In Drizzle: `active: boolean("active").generatedAlwaysAs(sql\`state = 'active'\`)`.
- [ ] **Step 4: `0016` security migration.**
  - Backfill: for each round, insert distinct non-blank `arrival_forecast` values as `arrival`/`arriving` and `enlistment_status` values as `enlistment`/`pending` (sort by name), then set the two option ids on the members.
  - RLS on `doch1_field_options`: select = in doch1 (`app.has_module('doch1')`, as the statuses policies do); insert/update/delete = battalion doch1 admin (copy the `doch1_statuses_*` policy expressions). Grants, `touch_updated_at`, `audit` triggers.
  - `grant update (arrival_option_id, enlistment_option_id, planned_unit_id) on doch1_members to authenticated`.
  - Trigger `app.doch1_member_options_guard()` (before insert/update of the option columns): the option's `field` matches the column, else `raise … errcode 'GD003'`.
  - Trigger `app.doch1_member_planned_unit_guard()` (before update of `planned_unit_id`): only the battalion doch1 admin may change it, else `GD004` (copy `app.doch1_member_location_guard` from `0008`).
- [ ] **Step 5:** `pnpm --filter @gdud/db test` → green. `pnpm typecheck` → **the web app fails** where it writes `rounds.active` (`_actions/settings.ts:55-60`). That's fixed in Task 3; leave it failing only within this branch and move on.
- [ ] **Step 6: Commit** `feat(doch1): round state, צפי הגעה / סטטוס גיוס value lists`.

### Task 2: Core — listing rule, roster diff, call-up summary

**Files:**
- Modify: `packages/core/src/doch1/counting.ts`, `counting.test.ts`
- Create: `packages/core/src/doch1/planning.ts`, `planning.test.ts` (roster diff, planning progress)
- Create: `packages/core/src/doch1/call-up.ts`, `call-up.test.ts` (summary, brigade text)
- Modify: `packages/core/src/doch1/index.ts` (exports)

**Interfaces produced:**

```ts
// counting.ts
export type ArrivalEffect = "arriving" | "not_arriving";
export type EnlistmentEffect = "arrived" | "pending" | "postponed" | "released";
export interface ServiceDates {
  callUpOn: Day | null;
  releasedOn: Day | null;
  /** false only for an explicit "not arriving" value; blank = arriving */
  arriving: boolean;
}
// inService / inServiceBetween: `m.arriving &&` first.

// planning.ts
export interface RosterRow { personalNumber: string; firstName: string; lastName: string; companyKey: string; platoonKey: string; phone: string | null; role: string | null; isOfficer: boolean | null; }
export interface RosterMember { personId: string; personalNumber: string; firstName: string; lastName: string; unitId: string; phone: string | null; role: string | null; isOfficer: boolean | null; }
export type RosterField = "name" | "unit" | "phone" | "role" | "isOfficer";
export interface RosterDiff {
  added: RosterRow[];                       // not in people
  returning: { row: RosterRow; personId: string }[]; // in people, not in base round
  changed: { row: RosterRow; member: RosterMember; fields: RosterField[] }[];
  missing: RosterMember[];                  // in base round, not in file
  unchanged: { row: RosterRow; member: RosterMember }[];
  problems: { row: number; message: string }[]; // duplicates, bad number
}
export function diffRoster(rows: RosterRow[], base: RosterMember[], people: Map<string, string /* personalNumber → personId */>, unitOf: (row: RosterRow) => string | null): RosterDiff;
export function planningProgress(members: { companyId: string; arrival: ArrivalEffect | null }[]): Map<string, { total: number; arriving: number; notArriving: number; blank: number }>;

// call-up.ts
export interface CallUpMember { personId: string; companyId: string; callUpOn: Day | null; releasedOn: Day | null; arriving: boolean; enlistment: EnlistmentEffect | null; enlistmentOptionId: string | null; }
export function expectedOn(m: CallUpMember, day: Day): boolean;
export function callUpSummary(members: CallUpMember[], day: Day): Map<string /* companyId | "all" */, { expected: number; arrived: number; pending: number; postponed: number; released: number; percent: number | null; byOption: Map<string, number> }>;
export function callUpBrigadeText(input: { battalion: string; day: Day; rows: { company: string; expected: number; arrived: number; percent: number | null }[] }): string;
```

- [ ] **Step 1: Failing tests.**
  - `counting.test.ts`: `inService({ callUpOn: "2026-09-06", releasedOn: null, arriving: false }, "2026-09-10") === false`; the same with `arriving: true` → true; `inServiceBetween` likewise.
  - `planning.test.ts`: one row per diff group; the same number twice → a problem, not two rows; numbers normalised with `normalizePersonalNumber` (`normalize.ts`) so `"8123456.0"` matches `"8123456"`; a changed phone only → `fields: ["phone"]`; an unknown unit (`unitOf` → null) → a problem.
  - `call-up.test.ts`: postponed and released leave `expected`; a not-arriving member isn't expected; `percent` null when expected is 0; the brigade text has no names (assert no `personId` / name substring) and matches a snapshot.
- [ ] **Step 2:** `pnpm --filter @gdud/core test` → fails.
- [ ] **Step 3:** Implement. Keep `diffRoster` pure; units are resolved by the caller through `unitOf`.
- [ ] **Step 4:** Tests green. `pnpm typecheck` lists every place that builds a `ServiceDates` without `arriving`. That list is Task 4's work list.
- [ ] **Step 5: Commit** `feat(doch1): not-arriving soldiers aren't listed; roster diff and call-up summary`.

### Task 3: Settings — round state and value lists

**Files:**
- Modify: `apps/web/src/app/(shell)/doch1/_actions/settings.ts` (`saveRound` → state; new `createRound`, `setRoundState`, `saveFieldOption`, `deleteFieldOption`)
- Modify: `apps/web/src/app/(shell)/doch1/settings/page.tsx`, `_components/round-form.tsx`
- Create: `apps/web/src/app/(shell)/doch1/settings/_components/field-options-editor.tsx`
- Modify: `apps/web/src/lib/doch1/data.ts` (`RoundVM.state`, `loadPlanningRound`, `loadFieldOptions`)

- [ ] **Step 1: Round state in settings.** Replace the "פעיל" checkbox with a state badge plus buttons: "סגירת סבב" (active → closed), "פתיחה מחדש" (closed → active, disabled while another round is active). Activation from planning is **not** here: it's on the planning screen (Task 9).
- [ ] **Step 2: "סבב חדש"** creates a `planning` round (disabled when one exists) and, in the same `withUser` transaction, copies from the latest round (by `starts_on`): `doch1_round_companies`, active `doch1_statuses` (new ids; drop `replaces_id`), `doch1_field_options`. Return the new round's id and open its settings.
- [ ] **Step 3: Value lists editor** — "צפי הגעה וסטטוס גיוס" section, two lists: name, effect (a select of that field's effects with Hebrew labels: מגיע / לא מגיע; התייצב / ממתין / נדחה / שוחרר), sort with up/down, delete. Deleting a value in use asks for a replacement (or blank) and updates the members in the same transaction. When a list is empty, show the spec's suggested values as one-tap "הוספה".
- [ ] **Step 4:** Settings works for both the active and the planning round (a round switcher at the top when both exist).
- [ ] **Step 5:** `pnpm typecheck && pnpm lint` (web: settings errors from Task 1 gone). Check by hand: create a planning round, see statuses and companies copied, add values.
- [ ] **Step 6: Commit** `feat(doch1): planning rounds and value lists in settings`.

### Task 4: Hiding not-arriving soldiers everywhere

**Files (from Task 2 Step 4's typecheck list; expected):**
- Modify: `apps/web/src/lib/doch1/data.ts` (`loadMembers` joins the arrival option → `arriving`, and adds `arrivalOptionId`, `enlistmentOptionId`)
- Modify: `apps/web/src/lib/doch1/soldier.ts`, `standby.ts`, `reminder-job.ts`
- Modify: `apps/web/src/app/(shell)/doch1/soldiers/_components/soldiers-board.tsx` (filter "לא מגיעים")
- Modify: `apps/web/src/app/(shell)/doch1/_components/overview-view.tsx`, `company-table.tsx` ("לא מגיעים: N")
- Modify: `apps/web/src/app/(shell)/doch1/soldiers/[personId]/page.tsx` and its edit form (tag, pickers from the list, mid-round warning)
- Modify: `apps/web/src/app/(shell)/doch1/_actions/members.ts` (`arrivalOptionId`, `enlistmentOptionId` replace the text fields; the mid-round check)
- Modify: `apps/web/src/app/(shell)/doch1/copy/…` (not-arriving rows kept, not counted as missing, like out-of-service)

- [ ] **Step 1:** Make every `ServiceDates` builder set `arriving` from the option's effect (`effect !== 'not_arriving'`; blank → true). Typecheck green.
- [ ] **Step 2:** Add a db test in `packages/db/test/` (or extend an existing doch1 loader test) that loads members of a round with one not-arriving soldier who has day entries and asserts `listedOn` drops them while their `doch1_days` rows remain.
- [ ] **Step 3: Soldier card.** "לא מגיע בסבב" tag; edit form pickers for צפי הגעה and סטטוס גיוס from `loadFieldOptions` (blank allowed). The action: when the new arrival value is `not_arriving` and the soldier has `doch1_days` rows in the round, return `{ confirm: { days: N } }` unless `force` is set. The form shows "לחייל יש N ימי דיווח בסבב. לסמן תאריך שחרור במקום?" with "שחרור מאתמול" (sets `released_on` = yesterday, not the value) and "לסמן לא מגיע".
- [ ] **Step 4: חיילים filter and overview count.** The overview's not-arriving count is per company plus total, outside the KPI sums.
- [ ] **Step 5:** `pnpm test && pnpm typecheck && pnpm lint`. By hand: mark a soldier "לא מגיע" → gone from today, board, overview counts and reminders; on the filter; switch back → returns.
- [ ] **Step 6: Commit** `feat(doch1): hide not-arriving soldiers from the round`.

### Task 5: Sheet import maps צפי הגעה and סטטוס גיוס

**Files:**
- Modify: `packages/db/src/doch1-import/plan.ts` (questions of kind `arrival` / `enlistment`; members carry option ids)
- Modify: `packages/db/src/doch1-import/apply.ts` (create answered options; write option ids; stop writing the text columns)
- Modify: `apps/web/src/app/(shell)/doch1/import/_components/…` (the question UI: map to a value, or "ליצור" with an effect select)
- Modify: `packages/db/test/doch1-import.test.ts`
- Modify: `packages/db/src/schema/doch1.ts` + create `packages/db/migrations/0017_doch1_drop_member_text_fields.sql` (generated: drop `arrival_forecast`, `enlistment_status`; revoke is implicit)

- [ ] **Step 1: Failing import tests:** an unknown column-I value is a question; answering "ליצור / לא מגיע" creates the option with that effect and sets it on the member; re-import with the remembered answer asks nothing; a blank cell clears the value (the sheet wins); a not-arriving soldier with day cells → a warning; the import doesn't touch a `planning` round's members.
- [ ] **Step 2:** Implement; the mapping kinds are `arrival` and `enlistment`, keyed by the trimmed sheet value.
- [ ] **Step 3:** Drop the text columns (schema + generate `0017`); fix any remaining reader (typecheck).
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(doch1): the sheet import maps צפי הגעה and סטטוס גיוס to the value lists`.

### Task 6: Battalion list — read, parse, plan

**Files:**
- Create: `packages/db/src/doch1-roster-import/read.ts` (xlsx/csv → rows; reuse `doch1-import/read.ts` helpers for cells and header matching)
- Create: `packages/db/src/doch1-roster-import/parse.ts` (header aliases for the אלפון layout + optional צפי הגעה / תאריך גיוס)
- Create: `packages/db/src/doch1-roster-import/plan.ts` (loads the base round's members, people by number, mappings; calls `diffRoster`; questions for unknown companies/platoons/arrival values)
- Create: `packages/db/src/doch1-roster-import/index.ts`; export from `packages/db/package.json` `exports` like `doch1-import`
- Create: `packages/db/test/doch1-roster-import.test.ts` (invented workbook built with exceljs in the test)

**Interfaces produced:**

```ts
export interface RosterPlan {
  planningRoundId: string;
  baseRoundId: string;
  diff: RosterDiff;
  questions: Question[];          // same shape as doch1-import's
  inActiveRound: Set<string>;     // personIds whose unit move must wait for activation
}
export async function planRoster(tx: Tx, input: { planningRoundId: string; baseRoundId?: string; workbook: Buffer; fileName: string; answers: Answers }): Promise<RosterPlan>;
```

- [ ] **Step 1: Failing tests:** headers in another order and with `\n` are found; one of each diff group from a small fixture; the base round defaults to the active one, else the latest closed one; a re-run after apply shows only remaining differences (members of the planning round count as "ours"); an unknown company → a question; nothing is written by `planRoster` (row counts unchanged).
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `pnpm --filter @gdud/db test` green.
- [ ] **Step 4: Commit** `feat(doch1): read and compare the battalion list`.

### Task 7: Battalion list — apply, corrections file, copy from last round

**Files:**
- Create: `packages/db/src/doch1-roster-import/apply.ts`
- Create: `packages/db/src/doch1-roster-import/corrections.ts` (xlsx of disagreements, exceljs)
- Modify: `packages/db/test/doch1-roster-import.test.ts`

**Interfaces produced:**

```ts
export type RosterDecisions = {
  add: Set<string>;                                   // personal numbers (added + returning) to add
  take: Map<string, Set<RosterField>>;                // personal number → fields taken from the battalion
  keepMissing: Set<string>;                           // personIds of "missing" kept in the round
};
export async function applyRoster(tx: Tx, plan: RosterPlan, decisions: RosterDecisions): Promise<{ created: number; updated: number; members: number; pendingMoves: number }>;
export async function copyFromRound(tx: Tx, planningRoundId: string, baseRoundId: string): Promise<{ members: number }>;
export function correctionsWorkbook(plan: RosterPlan, decisions: RosterDecisions): Promise<Buffer>;
```

- [ ] **Step 1: Failing tests:**
  - a new soldier → a `people` row and a planning membership with the round's `call_up_on`;
  - a taken unit change for a soldier **in the active round** → `people.unit_id` unchanged, `planned_unit_id` set; for a soldier not in the active round → `people.unit_id` changed, `planned_unit_id` null;
  - carried over from the base round: `dmh_category`, `has_disc`, `notes`, `location_id`;
  - a dropped "missing" soldier → no planning membership; their base membership untouched;
  - run as the battalion admin via `runAsUser` (RLS on), and as a company user → rejected;
  - `copyFromRound` copies every base member once; running it twice adds nothing;
  - `correctionsWorkbook` has one row per disagreement with both values.
- [ ] **Step 2:** Implement `applyRoster` in the caller's transaction (no own transaction), upserting members with `on conflict (round_id, person_id) do update`.
- [ ] **Step 3:** Tests green.
- [ ] **Step 4: Commit** `feat(doch1): apply the battalion list to the planning round`.

### Task 8: Planning screens

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/planning/page.tsx` (admin steps view / company user list)
- Create: `apps/web/src/app/(shell)/doch1/planning/_components/arrival-list.tsx` (phone-first list with chips, filters, bulk set + undo)
- Create: `apps/web/src/app/(shell)/doch1/planning/_components/planning-steps.tsx` (admin: progress per company, reminder button)
- Create: `apps/web/src/app/(shell)/doch1/planning/roster/page.tsx` + `_components/roster-preview.tsx` (upload, phases, preview groups with per-row choices, questions, apply, corrections download, "העתקה מהסבב הקודם")
- Create: `apps/web/src/app/(shell)/doch1/planning/roster/run/route.ts` (NDJSON phases, like `import/run/route.ts`)
- Create: `apps/web/src/app/(shell)/doch1/planning/roster/corrections/route.ts` (xlsx download, admin)
- Create: `apps/web/src/app/(shell)/doch1/_actions/planning.ts` (`setArrival`, `setArrivalBulk`, `requestArrivalReminder`)
- Modify: `apps/web/src/app/(shell)/doch1/_components/…` / `components/app-shell.tsx` (nav item "תכנון סבב" shown when a planning round exists)
- Modify: `apps/web/src/lib/doch1/reminder-job.ts`, `packages/core/src/doch1/reminders.ts` (+ test: the `arrival` request message "פלס״ר · חסר צפי הגעה ל־12 חיילים")

- [ ] **Step 1:** Core test for the arrival reminder message (counts and unit name only), then implement it.
- [ ] **Step 2:** `setArrival` / `setArrivalBulk`: zod (`personIds`, `optionId | null`), `can(…, ["admin","company_user"], unit)`, write via `withUser`. RLS rejects out-of-scope soldiers anyway; the action maps errors with `dbErrorMessage`.
- [ ] **Step 3:** Pages per the spec ("Planning screen", "The battalion list"). The roster page is admin only (`can(… ["admin"], null)`). The size limit and in-memory parsing are the same as the sheet import.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`. By hand, on a seeded local DB: create a planning round, upload an invented battalion list, decide, apply, download corrections; as a company user fill צפי הגעה; check progress on the admin view.
- [ ] **Step 5: Commit** `feat(doch1): planning screens — battalion list and צפי הגעה`.

### Task 9: Activation

**Files:**
- Modify: `apps/web/src/app/(shell)/doch1/_actions/planning.ts` (`activateRound`)
- Create: `packages/db/src/doch1-roster-import/activate.ts` (pure DB work, testable on PGlite)
- Modify: `packages/db/test/doch1-roster-import.test.ts`
- Modify: `apps/web/src/app/(shell)/doch1/planning/_components/planning-steps.tsx` (confirm dialog with the summary)

```ts
export async function activateRound(tx: Tx, planningRoundId: string): Promise<{ closedRoundId: string | null; moved: number }>;
```

- [ ] **Step 1: Failing tests:** the active round becomes `closed`, the planning one `active`; `people.unit_id` takes each `planned_unit_id`, which is then cleared; a forced failure mid-way (e.g. a `planned_unit_id` that was deleted between) rolls everything back; a company user can't activate.
- [ ] **Step 2:** Implement; the order inside the transaction is: close the active round, set the planning round active, apply the moves.
- [ ] **Step 3:** The confirm dialog lists: the round being closed, the start date of the new one, the number of soldiers changing company, and how many soldiers have a blank צפי הגעה (a warning, not a block).
- [ ] **Step 4:** Tests green. **Commit** `feat(doch1): activate a planning round`.

### Task 10: Call-up day screen

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/call-up/page.tsx` (`?day=`, default the round's `call_up_on`; `day-nav.tsx` reused)
- Create: `apps/web/src/app/(shell)/doch1/call-up/_components/call-up-list.tsx` (chips per soldier; postponed → date sheet; released → date sheet; undo)
- Create: `apps/web/src/app/(shell)/doch1/call-up/_components/call-up-summary.tsx` (table per company + battalion, brigade text with copy/share)
- Modify: `apps/web/src/app/(shell)/doch1/_actions/members.ts` (`setEnlistment`: option id + optional `callUpOn` / `releasedOn`, one update)
- Modify: nav (`components/app-shell.tsx`): "יום גיוס", shown for the active round

- [ ] **Step 1:** Implement `setEnlistment`: zod; for a `postponed` value require a new date after the current call-up date; for `released` a date on or after the call-up date (the existing `doch1_members_service_dates` check backs this up).
- [ ] **Step 2:** Page and components using `expectedOn` / `callUpSummary` / `callUpBrigadeText` from Task 2. Viewers see the summary only.
- [ ] **Step 3:** `pnpm test && pnpm typecheck && pnpm lint`. By hand: mark התייצב, נדחה (new date → soldier disappears from today until then), שוחרר (release date set); summary % matches a hand count.
- [ ] **Step 4: Commit** `feat(doch1): call-up day screen`.

### Task 11: Docs and final check

**Files:**
- Modify: `docs/DOCH1.md` (round states; settings › value lists; "Who is listed on a day" adds the not-arriving rule; new sections "Planning the next round" and "Call-up day"; the import's new mapping questions; the runbook for the next round)
- Modify: `references/doch1/sheet-structure.md` (column I and K now map to value lists)
- Modify: `docs/superpowers/specs/2026-10-22-doch1-design.md` ("Phase 5" → points to this spec)

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** `pnpm test && pnpm typecheck && pnpm lint` from the root → green.
- [ ] **Step 3:** Walk the whole flow once on a local DB: new planning round → battalion list → צפי הגעה as a company user → activate → call-up day → a not-arriving soldier is nowhere in the daily screens and is on the "לא מגיעים" filter.
- [ ] **Step 4: Commit** `docs(doch1): round planning and call-up day`.

## Order and dependencies

Task 1 → 2 → 3 → 4 → 5 must go in order: schema, then the core rule, then the settings that fix the `active` writes, then the readers, then the importer that drops the old columns. Tasks 6–7 (roster importer) only need Tasks 1–2 and can be done in parallel with 3–5 by another worker. Task 8 needs 3, 6 and 7. Task 9 needs 8. Task 10 needs 4. Task 11 is last.

Ship points: after Task 5, the hiding rule and the value lists already help the current round (the admin can import the sheet and set which column-I values mean "not arriving"). After Task 9, the next round can be planned. Task 10 is needed by the next call-up day.
