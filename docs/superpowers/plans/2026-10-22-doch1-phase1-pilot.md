# דוח 1 — Phase 1 (pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One company can report דוח 1 daily in the app (platoon commanders + clerk), with a push reminder, a database-enforced lock, a live battalion overview, a brigade-report preview, copy-to-sheet, and an in-app import of the current Google Sheet — while the sheet stays official.

**Architecture:** A new `doch1` module in the existing monorepo. Pure domain logic (dates/lock, counting, report text, normalization) lives in `@gdud/core` and is unit-tested. Tables, RLS and the lock trigger live in `@gdud/db` migrations and are tested on PGlite. The sheet importer lives in `@gdud/db/doch1-import` (read xlsx → parse → plan → apply inside the admin's RLS transaction). Pages and Server Actions in `apps/web/src/app/(shell)/doch1/` follow the logistics module's patterns. Reminders: web push from a cron endpoint triggered every 5 minutes by Supabase `pg_cron`.

**Tech Stack:** Next.js 16 (App Router, Server Actions, `proxy.ts`), React 19, Supabase Postgres + RLS, Drizzle 0.45, PGlite + Vitest 4, zod 4, Tzelem (`@gdud/ui`), `exceljs` (xlsx reading), `web-push` (VAPID push).

**Spec:** `docs/superpowers/specs/2026-10-22-doch1-design.md` (read it first). Sheet layout: `references/doch1/sheet-structure.md`. UI: `references/doch1/mockup/NN.html` (screen list in `mockup/INDEX.txt`).

**Out of this plan (later plans):** attendance board, rotation cycles, soldier card (including the read-only basics the spec lists under phase 1 — in this plan tapping a soldier opens the status sheet), enlistment lists (phase 2); שבצ״ק, standby, vehicles, outpost per soldier, and importing them (phase 3); reports R1–R5, data checks, attached forces (phase 4); per-round people import (phase 5); round-end snapshot of each member's unit.

## Global Constraints

- Read `CLAUDE.md`, `docs/SECURITY.md`, `docs/ADDING_A_MODULE.md` before Task 1.
- UI is Hebrew, RTL, Tzelem (`tz-` classes, tokens in `packages/ui/src/tzelem.css`). No new colors except status colors, which are data from settings and rendered as inline styles. Serials, personal numbers, phones, vehicle numbers: `<Serial>` / `tz-serial`.
- Every data access from a request: `withUser(session.claims, tx => …)`. `systemDb()` only in the cron route (a trusted server job) — never in a page or Server Action.
- Every page under `(shell)/doch1`: `requireModule("doch1")`, then `can()` for finer checks. Mutations: `can()` → zod → `withUser` write (RLS checks again).
- Every new table: `.enableRLS()`, explicit policies, explicit `GRANT`s, `app.audit()` trigger, `app.touch_updated_at()` where it has `updated_at`, tests in `packages/db/test/rls.test.ts`.
- **No status, location or group name in code.** Every count reads status flags/`display_group` from `doch1_statuses`. Sheet template knowledge (tab names like "Dropdowns", header aliases) is allowed in the importer only.
- All "today" / "now" logic uses `Asia/Jerusalem` (`DOCH1_TZ`). Day values are `YYYY-MM-DD` strings (`date(..., { mode: "string" })`).
- Push payloads carry counts and unit names only — never soldier names.
- Next.js 16: `proxy.ts` (not middleware), async `params`/`searchParams`/`cookies()`; docs in `apps/web/node_modules/next/dist/docs/`.
- New dependencies: `exceljs@4.4.0` (packages/db), `web-push@3.6.7` + `@types/web-push` (apps/web). Exact versions, nothing else.
- Done = `pnpm test && pnpm typecheck && pnpm lint` green.
- The checkout is currently not a git repository. Commit steps apply once it is (`git init` / clone). **Never commit `references/doch1/*.xlsx`** (real personal data).

## Review Focus

1. **Midnight in Israel vs UTC on the server** — a status saved at 00:30 Israel time on 22.10 (21:30 UTC on 21.10) must land on 22.10 and be checked against 22.10's lock. Test in Task 2 (`israelToday` both sides of midnight and both sides of the DST change on 25.10.2026).
2. **Platoon commander and clerk save the same soldier at the same time** — both succeed, the last save wins, no unique-violation error. Test in Task 6 (two upserts on the same `(person_id, day)`).
3. **A page opened before the lock and submitted after it** — the write is rejected by the database with a clear Hebrew message ("היום כבר ננעל…"), not "אין לך הרשאה". Test in Task 6 (SQLSTATE `GD001`); Task 9 maps `GD001` in `dbErrorMessage` (the web app has no unit-test setup), checked by hand in Task 12 Step 3.
4. **The same soldier in two company tabs** (old פלתצ tab + פלסר) — imported once, into the company that is active this round, and listed as a warning. Test in Task 8.
5. **Undo after a group update that wrote over planned days and filled empty ones** — undo restores the planned statuses and removes the entries that did not exist before. Test in Task 3 (`planBulkWrite` undo snapshot) and Task 12 (restore clears null rows).

---

### Task 1: Roles and repo hygiene

**Files:**
- Modify: `packages/core/src/modules.ts:48-60` (doch1 roles)
- Modify: `packages/auth/src/index.test.ts` (add cases)
- Modify: `.gitignore`

**Interfaces:**
- Produces: role id `"platoon_commander"` in `RoleOf<"doch1">`.

- [ ] **Step 1: Write the failing test** in `packages/auth/src/index.test.ts` (reuse the file's existing unit tree helpers; a company `plsr` with platoon `plsr1`, and a second platoon `plsr2`):

```ts
it("a doch1 platoon commander covers only their platoon", () => {
  const u = user([{ module: "doch1", role: "platoon_commander", unitId: plsr1 }]);
  expect(can(u, "doch1", ["platoon_commander"], plsr1, parents)).toBe(true);
  expect(can(u, "doch1", ["platoon_commander"], plsr2, parents)).toBe(false);
  expect(can(u, "doch1", ["platoon_commander"], plsr, parents)).toBe(false);
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @gdud/auth test` → FAIL (type error: `"platoon_commander"` not assignable).
- [ ] **Step 3: Add the role** to the doch1 entry, after `company_user`: `{ id: "platoon_commander", label: "מפקד מחלקה", description: "דוח 1 של המחלקה שלו: היום והימים הבאים" }`.
- [ ] **Step 4: Add to `.gitignore`** under the csv rule: `*.xlsx` with the comment `# sheet exports (xlsx) hold personal data — never commit them`.
- [ ] **Step 5: Run** `pnpm --filter @gdud/auth test && pnpm --filter @gdud/core typecheck` → PASS.
- [ ] **Step 6: Commit** — `feat(doch1): add platoon commander role`.

---

### Task 2: Core — dates and the lock rule

**Files:**
- Create: `packages/core/src/doch1/dates.ts`
- Create: `packages/core/src/doch1/index.ts` (re-exports every `doch1/*` file)
- Modify: `packages/core/src/index.ts` (add `export * from "./doch1";`)
- Test: `packages/core/src/doch1/dates.test.ts`

**Interfaces:**
- Produces:
  - `DOCH1_TZ = "Asia/Jerusalem"`
  - `type Day = string` (`YYYY-MM-DD`)
  - `israelToday(now: Date): Day`
  - `israelClock(now: Date): string` → `"HH:MM"` 24h
  - `addDays(day: Day, n: number): Day`
  - `dayRange(from: Day, to: Day): Day[]` (inclusive; `[]` if `to < from`)
  - `isDay(v: unknown): v is Day` (valid calendar date, exact format)
  - `isDayWritable(a: { day: Day; now: Date; lockAt: string; isAdmin: boolean }): boolean` — admin → true; `day > today` → true; `day === today` → `israelClock(now) < lockAt` (compare `"HH:MM"` prefix of `lockAt`); else false. Must match the SQL in Task 6.
  - `hebrewDayLabel(day: Day): string` → `"יום ב׳ 19.10"` (weekday letters א׳…ש׳, `dd.mm`)

- [ ] **Step 1: Write the failing tests**

```ts
describe("israelToday", () => {
  it("rolls over at Israel midnight, not UTC midnight (summer time, UTC+3)", () => {
    expect(israelToday(new Date("2026-10-21T20:59:00Z"))).toBe("2026-10-21");
    expect(israelToday(new Date("2026-10-21T21:30:00Z"))).toBe("2026-10-22");
  });
  it("uses UTC+2 after DST ends on 25.10.2026", () => {
    expect(israelToday(new Date("2026-10-26T21:30:00Z"))).toBe("2026-10-26");
    expect(israelToday(new Date("2026-10-26T22:30:00Z"))).toBe("2026-10-27");
  });
});
it("israelClock", () => expect(israelClock(new Date("2026-10-22T06:59:00Z"))).toBe("09:59"));
it("dayRange is inclusive and crosses months", () =>
  expect(dayRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]));
it("isDay rejects impossible dates", () => {
  expect(isDay("2026-02-30")).toBe(false);
  expect(isDay("2026-10-22")).toBe(true);
});
describe("isDayWritable", () => {
  const now = new Date("2026-10-22T06:59:00Z"); // 09:59 in Israel
  it("today before the lock", () => expect(isDayWritable({ day: "2026-10-22", now, lockAt: "10:00", isAdmin: false })).toBe(true));
  it("today after the lock", () =>
    expect(isDayWritable({ day: "2026-10-22", now: new Date("2026-10-22T07:01:00Z"), lockAt: "10:00:00", isAdmin: false })).toBe(false));
  it("future days are always open", () => expect(isDayWritable({ day: "2026-10-23", now, lockAt: "00:00", isAdmin: false })).toBe(true));
  it("past days only for admins", () => {
    expect(isDayWritable({ day: "2026-10-21", now, lockAt: "23:59", isAdmin: false })).toBe(false);
    expect(isDayWritable({ day: "2026-10-21", now, lockAt: "23:59", isAdmin: true })).toBe(true);
  });
});
it("hebrewDayLabel", () => expect(hebrewDayLabel("2026-10-19")).toBe("יום ב׳ 19.10"));
```

- [ ] **Step 2: Run** `pnpm --filter @gdud/core test` → FAIL (module not found).
- [ ] **Step 3: Implement** in `dates.ts` with `Intl.DateTimeFormat("en-CA", { timeZone: DOCH1_TZ, … })` for `israelToday`/`israelClock`; day arithmetic on UTC dates (`Date.UTC`) so it never depends on the server zone.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(doch1): Israel-time day and lock rules`.

---

### Task 3: Core — counting, fill from yesterday, group update

**Files:**
- Create: `packages/core/src/doch1/counting.ts`
- Test: `packages/core/src/doch1/counting.test.ts`

**Interfaces:**
- Consumes: `Day` (Task 2).
- Produces:

```ts
export interface StatusFlags {
  countsInSadak: boolean; countsAsPresent: boolean; homeDay: boolean; orgDay: boolean;
  generalDay: boolean; offDuty: boolean; acrossBorder: boolean; needsOutpost: boolean;
}
export interface StatusDef extends StatusFlags {
  id: string; name: string; color: string; displayGroup: string; sheetValue: string; sortOrder: number; active: boolean;
}
export interface ReportMember { personId: string; companyId: string; platoonId: string | null; inReport: boolean; }
/** personId → statusId for one day; a missing key = no entry (= missing report). */
export type DayStatuses = ReadonlyMap<string, string>;
export interface GroupCount { name: string; color: string; count: number; }
export interface Summary {
  roster: number;       // members counted (inReport)
  reported: number;     // members with any entry
  missing: number;      // inReport members without an entry
  inSadak: number;      // entries whose status countsInSadak
  offDuty: number;      // entries whose status offDuty
  groups: GroupCount[]; // countsInSadak statuses grouped by displayGroup, ordered by the group's lowest sortOrder; color = that status's color
  completion: number;   // reported / roster, 0..1 (1 when roster = 0)
}
export function summarize(members: readonly ReportMember[], day: DayStatuses, statuses: readonly StatusDef[]): Summary;
export function missingMembers<T extends ReportMember>(members: readonly T[], day: DayStatuses): T[];
export function fillFromYesterdayPlan(members: readonly ReportMember[], today: DayStatuses, yesterday: DayStatuses): Array<{ personId: string; statusId: string }>;
export interface DayWrite { personId: string; day: Day; statusId: string | null; }
/** existing: `${personId}|${day}` → statusId */
export function planBulkWrite(existing: ReadonlyMap<string, string>, personIds: readonly string[], days: readonly Day[], statusId: string):
  { writes: DayWrite[]; undo: DayWrite[]; overwritten: number };
```

- `fillFromYesterdayPlan`: only `inReport` members with no entry today and an entry yesterday.
- `planBulkWrite`: `writes` = every person×day (skip cells already equal to `statusId`); `undo` = the previous value of each written cell (`null` where there was none); `overwritten` = writes that replaced a *different* existing status.

- [ ] **Step 1: Write the failing tests** — fixtures: statuses `A` (inSadak, group "עזה", sort 1, color "#e07b2e"), `B` (inSadak, group "אחר", sort 5), `C` (inSadak, group "עזה", sort 3), `Z` (offDuty, not inSadak, group "לא בשמ״פ", sort 9); members m1..m4 in company `c1`, m4 `inReport: false`.

```ts
it("summarize counts by flags and display group, not names", () => {
  const s = summarize(members, new Map([["m1", "A"], ["m2", "C"], ["m4", "B"]]), statuses);
  expect(s).toMatchObject({ roster: 3, reported: 2, missing: 1, inSadak: 2, offDuty: 0 });
  expect(s.groups).toEqual([{ name: "עזה", color: "#e07b2e", count: 2 }]);
  expect(s.completion).toBeCloseTo(2 / 3);
});
it("off-duty is reported, not missing, and not in סד״כ", () => {
  const s = summarize(members, new Map([["m1", "Z"], ["m2", "A"], ["m3", "A"]]), statuses);
  expect(s).toMatchObject({ reported: 3, missing: 0, inSadak: 2, offDuty: 1 });
});
it("fill from yesterday only touches today's missing", () =>
  expect(fillFromYesterdayPlan(members, new Map([["m1", "A"]]), new Map([["m1", "B"], ["m2", "B"], ["m4", "A"]])))
    .toEqual([{ personId: "m2", statusId: "B" }]));
it("planBulkWrite keeps an exact undo", () => {
  const r = planBulkWrite(new Map([["m1|2026-10-23", "B"], ["m1|2026-10-24", "A"]]), ["m1"], ["2026-10-23", "2026-10-24", "2026-10-25"], "A");
  expect(r.writes.map((w) => w.day)).toEqual(["2026-10-23", "2026-10-25"]);
  expect(r.undo).toEqual([
    { personId: "m1", day: "2026-10-23", statusId: "B" },
    { personId: "m1", day: "2026-10-25", statusId: null },
  ]);
  expect(r.overwritten).toBe(1);
});
```

- [ ] **Step 2: Run** `pnpm --filter @gdud/core test` → FAIL.
- [ ] **Step 3: Implement** the five functions in `counting.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(doch1): flag-driven counting and group update planning`.

---

### Task 4: Core — brigade text, copy-to-sheet lines, import normalization

**Files:**
- Create: `packages/core/src/doch1/outputs.ts`, `packages/core/src/doch1/normalize.ts`
- Test: `packages/core/src/doch1/outputs.test.ts`, `packages/core/src/doch1/normalize.test.ts`

**Interfaces:**
- Consumes: `Summary`, `GroupCount` (Task 3), `hebrewDayLabel` (Task 2).
- Produces:

```ts
export interface BrigadeInput {
  battalionName: string; day: Day;
  total: Summary;                                   // whole battalion
  companies: Array<{ name: string; summary: Summary }>; // in unit sort order
  missingNames?: Array<{ company: string; name: string }>;
}
export function brigadeReportText(input: BrigadeInput, opts: { byCompany: boolean; missingNames: boolean }): string;
export function sheetColumnLines(rows: ReadonlyArray<{ sheetRow: number | null; value: string }>): { lines: string[]; firstRow: number | null; notInSheet: number };
export function canonicalName(s: string): string;
export function normalizePersonalNumber(v: unknown): string | null;
export function cellText(v: unknown): string; // trimmed text; "" for null/undefined/#N/A/#REF!/"-"/whitespace
```

- Brigade format (exact, from mockup screen 10): line 1 `*{battalion} – דוח 1 · {hebrewDayLabel}{missing>0 ? " (חלקי)" : ""}*`; line 2 `בסד״כ: {inSadak} מתוך {roster}`; then the items `"{group} {count}"` for each group plus a last item `"חסרי דיווח {missing}"`, two items per line joined with `" · "`; if `byCompany`: `*לפי פלוגה (בסד״כ / חסרים)*` then `"{name} {inSadak} / {missing}"` two per line; if `missingNames` and any: `*חסרי דיווח*` then one line per company `"{company}: name, name"`. Lines joined with `"\n"`.
- `sheetColumnLines`: one line per sheet row from the smallest to the largest `sheetRow`, `""` for rows nobody holds; `notInSheet` = rows with `sheetRow === null`.
- `canonicalName`: NFC, `״`→`"`, `׳`→`'`, remove `"` and `'`, collapse whitespace, trim. So `מפל"ג`, `מפל״ג`, `מפלג` are equal.
- `normalizePersonalNumber`: number → integer string; string → trimmed, `.0` suffix removed, must match `^\d{5,9}$` else `null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("brigade text matches the mockup format", () => {
  const sum = (inSadak: number, roster: number, missing: number, groups: GroupCount[]) =>
    ({ roster, reported: roster - missing, missing, inSadak, offDuty: 0, groups, completion: 0 });
  const text = brigadeReportText({
    battalionName: "גדס״ר", day: "2026-10-19",
    total: sum(492, 648, 60, [{ name: "עזה", color: "", count: 116 }, { name: "מיוערת", color: "", count: 117 }, { name: "רענון", color: "", count: 199 }]),
    companies: [{ name: "אגם", summary: sum(65, 78, 5, []) }, { name: "מסייעת", summary: sum(75, 94, 12, []) }, { name: "פלנט", summary: sum(87, 123, 14, []) }],
  }, { byCompany: true, missingNames: false });
  expect(text).toBe([
    "*גדס״ר – דוח 1 · יום ב׳ 19.10 (חלקי)*",
    "בסד״כ: 492 מתוך 648",
    "עזה 116 · מיוערת 117",
    "רענון 199 · חסרי דיווח 60",
    "*לפי פלוגה (בסד״כ / חסרים)*",
    "אגם 65 / 5 · מסייעת 75 / 12",
    "פלנט 87 / 14",
  ].join("\n"));
});
it("no (חלקי) when nothing is missing", () => { /* missing 0 → header without " (חלקי)" */ });
it("sheet lines fill gaps and count app-only soldiers", () =>
  expect(sheetColumnLines([{ sheetRow: 6, value: "עזה" }, { sheetRow: 4, value: "0" }, { sheetRow: null, value: "רענון" }]))
    .toEqual({ lines: ["0", "", "עזה"], firstRow: 4, notInSheet: 1 }));
it("canonicalName folds gershayim and quotes", () => {
  expect(canonicalName(" מפל״ג ")).toBe(canonicalName('מפל"ג'));
  expect(canonicalName("מפלג")).toBe(canonicalName('מפל"ג'));
});
it("normalizePersonalNumber", () => {
  expect(normalizePersonalNumber(8123456)).toBe("8123456");
  expect(normalizePersonalNumber(" 8123456.0 ")).toBe("8123456");
  expect(normalizePersonalNumber("#N/A")).toBeNull();
});
it("cellText treats sheet errors as empty", () => expect(["#N/A", "#REF!", "-", " ", null].map(cellText)).toEqual(["", "", "", "", ""]));
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter @gdud/core test` → PASS.
- [ ] **Step 5: Commit** — `feat(doch1): brigade text, copy-to-sheet lines, sheet value normalization`.

---

### Task 5: Database schema

**Files:**
- Create: `packages/db/src/schema/doch1.ts`
- Modify: `packages/db/src/schema/index.ts` (add `export * from "./doch1";`)
- Create (generated): `packages/db/migrations/0004_doch1.sql` + `meta/*`

**Interfaces:**
- Produces the Drizzle tables below (exported names in parentheses). Use the logistics file's `timestamps` and `actor()` helpers (copy them locally, same as logistics does). Days are `date(..., { mode: "string" })`, times `time(...)`. Every table `.enableRLS()`.

| Table (export) | Columns | Constraints |
|---|---|---|
| `doch1_rounds` (`doch1Rounds`) | `id` uuid pk; `name` text; `starts_on`, `ends_on` date; `call_up_on` date null; `reminder_at` time default `'09:00'`; `lock_at` time default `'10:00'`; `send_at` time default `'10:15'`; `active` bool default false; timestamps | check `ends_on >= starts_on`; unique index on `(active)` where `active` (one active round) |
| `doch1_round_companies` (`doch1RoundCompanies`) | `round_id` → rounds cascade; `unit_id` → units restrict; `active` bool default true; `app_from` date null (pilot switch); timestamps | pk `(round_id, unit_id)` |
| `doch1_statuses` (`doch1Statuses`) | `id`; `round_id` → rounds cascade; `name`; `color` (`#rrggbb` check); `display_group`; `sheet_value`; `sort_order` int; the 8 flag booleans `counts_in_sadak, counts_as_present, home_day, org_day, general_day, off_duty, across_border, needs_outpost` (default false); `active` default true; `replaces_id` uuid null → statuses; timestamps | unique index `(round_id, name)` where active; unique index `(round_id, sheet_value)` where active; check `not (counts_in_sadak and off_duty)` |
| `doch1_members` (`doch1Members`) | `round_id` → rounds cascade; `person_id` → people restrict; `in_report` bool default true; `dmh_category` text null; `arrival_forecast` text null; `call_up_on` date null; `enlistment_status` text null; `has_disc` bool null; `notes` text null; `sheet_tab` text null; `sheet_row` int null; timestamps | pk `(round_id, person_id)`; check `sheet_row > 0` |
| `doch1_days` (`doch1Days`) | `round_id`; `person_id`; `day` date; `status_id` → statuses restrict; `updated_by` actor; timestamps | pk `(person_id, day)`; fk `(round_id, person_id)` → members cascade; index `(round_id, day)` |
| `doch1_push_subscriptions` (`doch1PushSubscriptions`) | `id`; `user_id` → app_users cascade, default `app.current_user_id()`; `endpoint` text unique; `p256dh`, `auth` text; `user_agent` text null; `created_at` | check `endpoint like 'https://%'` |
| `doch1_reminder_requests` (`doch1ReminderRequests`) | `id`; `round_id`; `unit_id` → units; `requested_by` actor; `created_at`; `processed_at` null | |
| `doch1_reminder_log` (`doch1ReminderLog`) | `id` bigserial; `round_id`; `day` date; `kind` text check in (`'daily'`,`'request'`); `unit_id`; `user_id`; `missing` int; `ok` bool; `sent_at` default now | unique index `(round_id, day, user_id)` where `kind = 'daily'` |
| `doch1_brigade_log` (`doch1BrigadeLog`) | `id` bigserial; `round_id`; `day`; `partial` bool; `content` text; `sent_by` actor; `created_at` | |
| `doch1_import_mappings` (`doch1ImportMappings`) | `round_id` → rounds cascade; `kind` text check in (`'company'`,`'platoon'`,`'status'`); `source_key` text (canonical); `target_id` uuid null (null = ignore); timestamps | pk `(round_id, kind, source_key)` |

- [ ] **Step 1: Write `doch1.ts`** with a header comment mapping sheet → table, like `logistics.ts:1-16`.
- [ ] **Step 2: Generate** — `pnpm db:generate --name doch1` → creates `0004_doch1.sql`. Read it: tables, the partial unique indexes and the composite FK are present.
- [ ] **Step 3: Run** `pnpm --filter @gdud/db test` → existing tests still PASS (migrations apply on PGlite).
- [ ] **Step 4: Commit** — `feat(doch1): tables`.

---

### Task 6: Security migration and RLS tests

**Files:**
- Create: `packages/db/migrations/0005_doch1_security.sql` via `pnpm --filter @gdud/db exec drizzle-kit generate --custom --name doch1_security`
- Test: `packages/db/test/rls.test.ts` (new `describe("doch1")` block after logistics)

**Interfaces:**
- Consumes: tables from Task 5; `app.has_role`, `app.has_module`, `app.current_user_id`, `app.audit`, `app.touch_updated_at` from `0001_security.sql`.
- Produces (SQL):
  - `app.doch1_person_unit(p_person uuid) returns uuid` — security definer, `search_path=''`, `people.unit_id` gated by `app.has_module('doch1')` (copy `0003:18-21`).
  - `app.doch1_day_open(p_round uuid, p_day date) returns boolean` — security definer. `app.has_role('doch1', array['admin'])` (battalion) OR `p_day > il_today` OR (`p_day = il_today` AND `il_now::time < r.lock_at`), where `il_now = now() at time zone 'Asia/Jerusalem'`. Same rule as `isDayWritable` (Task 2).
  - Trigger `doch1_days_guard` BEFORE INSERT/UPDATE/DELETE on `doch1_days`: raise `using errcode = 'GD001', message = 'day locked'` if `not app.doch1_day_open` for NEW (and OLD on update/delete); raise `errcode = 'GD002'` if `day` is outside the round's `starts_on..ends_on`.
  - Header comment with the who-can-do-what matrix (format of `0003:1-13`).

Policies (`(select …)` wrapping where there is no row argument, as in 0003):

| Table | select | insert / update / delete |
|---|---|---|
| rounds, round_companies, statuses | `app.has_module('doch1')` | `app.has_role('doch1', array['admin'])` |
| members | `app.has_role('doch1', null, app.doch1_person_unit(person_id))` | insert/delete: battalion admin; update: `has_role('doch1', array['admin','company_user'], doch1_person_unit(person_id))` |
| days | same as members | `has_role('doch1', array['admin','company_user','platoon_commander'], doch1_person_unit(person_id))` (+ the guard trigger) |
| push_subscriptions | `user_id = app.current_user_id()` | insert/delete own; no update |
| reminder_requests | battalion admin | insert: battalion admin and `requested_by is not distinct from app.current_user_id()` |
| reminder_log | battalion admin | none (written by the cron job as owner) |
| brigade_log | battalion admin | insert: battalion admin and `sent_by is not distinct from app.current_user_id()` |
| import_mappings | battalion admin | battalion admin |
| **people** (drop + recreate `people_insert` / `people_update`, keeping core and logistics clauses) | — | add `or app.has_role('doch1', array['admin','company_user'], unit_id)` |

Grants: `select, insert, update, delete` on rounds, round_companies, statuses, import_mappings; members `select, insert, delete` + `update (in_report, dmh_category, arrival_forecast, call_up_on, enlistment_status, has_disc, notes, sheet_tab, sheet_row)`; days `select, insert, delete` + `update (status_id, updated_by, updated_at)`; push_subscriptions `select, insert, delete`; reminder_requests, brigade_log `select, insert`; reminder_log `select`; `usage` on the bigserial sequences. Audit triggers on all ten tables; touch triggers on tables with `updated_at`.

- [ ] **Step 1: Write the failing tests** in `describe("doch1")`. Nested `beforeAll` (pattern `rls.test.ts:337-366`): users `d1Admin` (doch1 admin, battalion), `plsrClerk` (company_user on `plsr`), `plsr1Cmdr` (platoon_commander on `plsr1`), `plntClerk` (company_user on `plnt`), `d1Viewer` (viewer on battalion). Seed as owner: one active round `starts_on = today-30`, `ends_on = today+30`, `lock_at '23:59:59'`; statuses `A`, `Z`; members for the three seeded people; `today = israelToday(new Date())` from `@gdud/core`. Helper `setDay(u, personId, day, statusId)` = insert … `onConflictDoUpdate` on `(personId, day)`.

```ts
it("platoon commander writes only their platoon", async () => {
  await setDay(plsr1Cmdr, p.plsr1Soldier, today, st.A);
  await rejects(setDay(plsr1Cmdr, p.plsrSoldier, today, st.A)); // company level, outside the platoon
});
it("company user covers the company's platoons, not another company", async () => {
  await setDay(plsrClerk, p.plsr1Soldier, today, st.Z);
  await rejects(setDay(plsrClerk, p.plntSoldier, today, st.A));
  expect(await as(plntClerk, (tx) => tx.select().from(days).where(eq(days.personId, p.plsr1Soldier)))).toHaveLength(0);
});
it("two saves of the same soldier and day: last one wins", async () => {
  await setDay(plsr1Cmdr, p.plsr1Soldier, today, st.A);
  await setDay(plsrClerk, p.plsr1Soldier, today, st.Z);
  const [row] = await db.select().from(days).where(and(eq(days.personId, p.plsr1Soldier), eq(days.day, today)));
  expect(row!.statusId).toBe(st.Z);
});
it("after the lock only the battalion admin can change today", async () => {
  await db.update(rounds).set({ lockAt: "00:00:00" }).where(eq(rounds.id, roundId));
  expect(await setDay(plsrClerk, p.plsr1Soldier, today, st.A).then(() => "ok", pgCodeOf)).toBe("GD001");
  await setDay(d1Admin, p.plsr1Soldier, today, st.A);
  await setDay(plsrClerk, p.plsr1Soldier, addDays(today, 1), st.A); // tomorrow stays open
  await db.update(rounds).set({ lockAt: "23:59:59" }).where(eq(rounds.id, roundId));
});
it("past days are admin-only; days outside the round are rejected", async () => {
  await rejects(setDay(plsrClerk, p.plsr1Soldier, addDays(today, -1), st.A));
  await setDay(d1Admin, p.plsr1Soldier, addDays(today, -1), st.A);
  expect(await setDay(d1Admin, p.plsr1Soldier, addDays(today, 31), st.A).then(() => "ok", pgCodeOf)).toBe("GD002");
});
it("viewer reads but cannot write", async () => {
  expect((await as(d1Viewer, (tx) => tx.select().from(days))).length).toBeGreaterThan(0);
  await rejects(setDay(d1Viewer, p.plsr1Soldier, addDays(today, 1), st.A));
});
it("only battalion admins change settings", async () => {
  expect(await as(plsrClerk, (tx) => tx.update(statuses).set({ color: "#000000" }).where(eq(statuses.id, st.A)).returning())).toHaveLength(0);
  expect(await as(d1Admin, (tx) => tx.update(statuses).set({ color: "#000000" }).where(eq(statuses.id, st.A)).returning())).toHaveLength(1);
});
it("push subscriptions are private to their owner", async () => {
  await as(plsrClerk, (tx) => tx.insert(pushSubs).values({ endpoint: "https://push.example/1", p256dh: "k", auth: "a" }));
  expect(await as(plntClerk, (tx) => tx.select().from(pushSubs))).toHaveLength(0);
  expect(await as(plsrClerk, (tx) => tx.select().from(pushSubs))).toHaveLength(1);
});
it("doch1 company user can edit their soldiers in people; not another company's", async () => { /* update full_name on plsr1 soldier ok; plnt soldier → 0 rows */ });
it("writes are audited with the acting user", async () => { /* audit_log row for doch1_days with actor = plsrClerk.appId */ });
```

`pgCodeOf(err: unknown): string | undefined` is a test helper in the block: walk `err` → `.cause` up to 4 levels and return the first string `code` (same walk as `pgCode` in `apps/web/src/lib/action-result.ts`).

- [ ] **Step 2: Run** `pnpm --filter @gdud/db test` → FAIL (no policies; writes rejected/allowed wrongly).
- [ ] **Step 3: Write `0005_doch1_security.sql`** per the tables above, `--> statement-breakpoint` between statements.
- [ ] **Step 4: Run** → PASS (all old tests too).
- [ ] **Step 5: Commit** — `feat(doch1): RLS, grants, lock guard, audit`.

---

### Task 7: Sheet reader and parser

**Files:**
- Modify: `packages/db/package.json` (dependency `exceljs: 4.4.0`; export `"./doch1-import": "./src/doch1-import/index.ts"`)
- Create: `packages/db/src/doch1-import/read.ts`, `parse.ts`, `index.ts`
- Test: `packages/db/test/doch1-import.test.ts` (parse part)

**Interfaces:**
- Consumes: `cellText`, `normalizePersonalNumber`, `canonicalName`, `isDay` (Tasks 2, 4).
- Produces:

```ts
export type Cell = string | number | boolean | Date | null;
export interface SheetGrid { name: string; hidden: boolean; rows: Cell[][] } // rows[0] = sheet row 1
export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<SheetGrid[]>; // exceljs; formula cells → cached result; dates → Date (UTC)
export interface ParsedRow {
  sheetRow: number; personalNumber: string; firstName: string; lastName: string;
  platoonText: string; roleTitle: string; dmhCategory: string; phone: string;
  arrivalForecast: string; callUpOn: Day | null; enlistmentStatus: string; hasDisc: boolean | null; notes: string;
  days: Map<Day, string>; // every date column; "" = empty cell; numeric 0 → "0"
}
export interface ParsedTab { tabName: string; key: string /* canonicalName(tabName) */; rows: ParsedRow[]; firstDay: Day; lastDay: Day }
export interface StatusGroupHint { value: string; groups: Array<"present" | "general" | "home" | "org" | "notCounted"> }
export interface ParsedSheet { tabs: ParsedTab[]; statusHints: StatusGroupHint[]; roundStart: Day | null; roundEnd: Day | null; warnings: string[] }
export function parseSheet(grids: readonly SheetGrid[]): ParsedSheet;
```

Rules (from `references/doch1/sheet-structure.md`):
- A **day tab** = header row 3 contains a header matching `מספר אישי` and at least one `Date` cell. Every day tab is returned, including `גדודי`; the plan step (Task 8) decides which tabs map to companies.
- Columns are found by header text (row 3, `canonicalName`, newlines → spaces), via an alias table in `parse.ts`: personal number `[מספר אישי]`; first `[שם פרטי]`; last `[שם משפחה]`; platoon `[מסגרת]`; role `[תפקיד בפועל, תקן]`; dmh `[תפקיד לדמח]`; phone `[טלפון]`; arrival `[סטטוס הגעה על פי צפי גיוס]`; call-up date `[תאריך גיוס על פי צפי גיוס, תאריך גיוס]`; enlistment `[סטטוס גיוס]`; disc `[דיסקית]` (`יש`→true, `אין`→false); notes `[הערות]`. A missing optional column → `""`/`null`. Day columns = header cells that are `Date`; stop at the first non-date header after the first date (the sentinel `BT`).
- Data rows start at row 4; a row is skipped when its personal number is missing/invalid (warning with tab + row when the row has any other value).
- `statusHints` from the `Dropdowns` tab's row-2 headers `שנספר`, `כללי`, `רענון`, `התארגנות`, `שלא נספר` (values below each header until an empty cell). Round dates from `Dropdowns!L1` and `N1` when they are dates.

- [ ] **Step 1: Write the failing tests.** Build grids in code (no xlsx) with a helper `companyTab(name, rows)` that makes row 3 headers `["פלוגה","מסגרת","מספר אישי","שם פרטי","שם משפחה","תפקיד בפועל",'תפקיד לדמ"ח',"טלפון", …, Date(2026-10-20), Date(2026-10-21), "אבוי למי שנוגע"]`. Invented names only.

```ts
it("reads soldiers and day cells by header, not position", () => { /* תפקיד/טלפון swapped between two tabs; both parse the same */ });
it("treats numeric 0 as '0' and empty as ''", () => { /* days.get("2026-10-20") === "0", days.get("2026-10-21") === "" */ });
it("normalizes personal numbers and skips rows without one", () => { /* 8123456.0 → "8123456"; row with name but no number → warning */ });
it("stops at the sentinel column", () => { /* lastDay === "2026-10-21" */ });
it("reads status groups and round dates from Dropdowns", () => { /* hints for עזה: ["present","general"]; "0": ["notCounted"] */ });
it("accepts the old פלתצ column order", () => { /* שם משפחה before שם פרטי, no תפקיד לדמ"ח → dmhCategory "" */ });
it("round-trips through a real xlsx buffer", async () => {
  // build with exceljs in memory: one tab, a formula cell with a cached Date result in row 3
  const grids = await readWorkbook(await buildXlsx());
  expect(parseSheet(grids).tabs[0]!.firstDay).toBe("2026-10-20");
});
```

- [ ] **Step 2: Run** `pnpm --filter @gdud/db test -- doch1-import` → FAIL.
- [ ] **Step 3: Implement** `read.ts` (exceljs `Workbook.xlsx.load`; for each worksheet keep `state !== "visible"` as `hidden`; cell → `result` for formula cells, `text` for rich text, `Date` as is) and `parse.ts`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(doch1): read and parse the round sheet`.

---

### Task 8: Import plan and apply

**Files:**
- Create: `packages/db/src/doch1-import/plan.ts`, `apply.ts`; export from `index.ts`
- Test: `packages/db/test/doch1-import.test.ts` (DB part, PGlite with real migrations, like `import-logistics.test.ts`)

**Interfaces:**
- Consumes: `ParsedSheet` (Task 7), schema (Task 5), `Tx` from `@gdud/db`.
- Produces:

```ts
export interface ImportMappings {
  tabs: Record<string /* tab key */, string | "ignore">;          // → company unit id
  platoons: Record<string /* `${companyId}|${canon}` */, string | "create" | "company">;
  statuses: Record<string /* sheet value */, string | "create">;  // → status id
}
export interface MappingQuestion { kind: "tab" | "platoon" | "status"; key: string; label: string; suggestion: string | null; options: Array<{ id: string; label: string }> }
export interface ImportCounts { newPeople: number; updatedPeople: number; members: number; daysWritten: number; daysCleared: number; daysSkippedPilot: number; statusesCreated: number; platoonsCreated: number }
export interface SheetImportPlan {
  roundId: string; questions: MappingQuestion[]; counts: ImportCounts;
  warnings: string[];                                   // duplicates, invalid rows, days outside the round
  notInSheet: Array<{ personId: string; name: string; company: string }>; // in the round, not in the file — kept
}
export async function planSheetImport(tx: Tx, roundId: string, parsed: ParsedSheet, mappings: Partial<ImportMappings>): Promise<SheetImportPlan>;
export async function applySheetImport(tx: Tx, roundId: string, parsed: ParsedSheet, mappings: ImportMappings): Promise<ImportCounts>;
```

Rules:
- **Saved mappings** from `doch1_import_mappings` fill any key the caller didn't pass; `applySheetImport` saves every mapping it used.
- **Tabs:** auto-map a tab whose key equals `canonicalName` of an active company unit; `גדודי` and unmatched tabs → question with suggestion `"ignore"`. Mapped companies are upserted into `doch1_round_companies` (`active` unchanged if present).
- **Platoons:** `canonicalName(platoonText)` matched against platoon units under that company; unknown → question, suggestion `"create"`; empty → `"company"` (soldier stays at company level). `"create"` inserts a `units` row (`kind: "platoon"`, `name` = the sheet text as written) — needs the core admin role; on RLS failure throw `UserError`-style `Error("ליצירת מחלקות צריך הרשאת מנהל ליבה")`.
- **Statuses:** every distinct non-empty day value must map. If the round has no statuses yet, all are auto-`"create"`. Created statuses: `name = sheetValue = value`, flags from `statusHints` (present→`countsAsPresent`, general→`generalDay`, home→`homeDay`, org→`orgDay`, notCounted→`offDuty`), `countsInSadak = !offDuty`, `displayGroup = name`, `color = "#7a8699"`, `sortOrder` = order of first appearance. The admin fixes colors, groups and the other flags in settings afterwards.
- **People:** match by personal number. New → insert (`fullName = first + " " + last`, `unitId` = platoon or company, `phone`, `roleTitle`, `personalNumber`). Existing → update those fields only when different.
- **Duplicates:** a personal number in two mapped tabs → keep the tab whose company is `active` in this round (first tab order if both), warning `"{מספר} מופיע בשתי לשוניות: {a}, {b}"`.
- **Members:** upsert `(round_id, person_id)` with dmh, arrival, call-up date, enlistment, disc, notes, `sheet_tab`, `sheet_row`.
- **Days** (only dates inside the round): for each cell — company has `app_from` and `day >= app_from` → skip (count `daysSkippedPilot`); value non-empty → upsert when different; value empty and an entry exists → delete (`daysCleared`). Writes in chunks of 500.
- **Not in the sheet:** round members whose person isn't in any mapped tab → `notInSheet` (never deleted).
- `applySheetImport` throws if any question remains unanswered. The whole apply runs inside the caller's single transaction.

- [ ] **Step 1: Write the failing tests** (seed as owner: battalion, companies `פלס״ר`, `פלנ״ט`, platoon `מחלקה 1` under פלס״ר; an active round 2026-08-23..2026-12-10; run apply as a user with doch1 admin + core admin through `runAsUser`).

```ts
it("asks about unknown tabs, platoons and statuses, with suggestions", async () => { /* questions include tab "גדודי" → "ignore", platoon "מפל״ג" → "create" */ });
it("imports people, members and days; '0' maps to the off-duty status", async () => { /* counts.newPeople 3; day row for "0" points at status with offDuty */ });
it("is idempotent", async () => { /* second apply: newPeople 0, updatedPeople 0, daysWritten 0, daysCleared 0 */ });
it("an empty cell clears an existing entry", async () => { /* re-import with a blanked cell → daysCleared 1 */ });
it("pilot company days from app_from are never touched", async () => {
  // set app_from = 2026-10-21 on פלס״ר, change a 21.10 cell in the sheet → that row unchanged, daysSkippedPilot > 0; 20.10 still imported
});
it("a soldier in two tabs is imported once, into the active company", async () => { /* warning text present; one member row */ });
it("soldiers missing from the file are listed, not removed", async () => { /* notInSheet has them; member row still exists */ });
it("reuses saved mappings on the next import", async () => { /* second plan has no questions */ });
it("refuses to apply with open questions", async () => { /* rejects */ });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `plan.ts` (pure resolution + DB reads) and `apply.ts` (writes). Share the resolution code: `apply` calls the same resolver as `plan`.
- [ ] **Step 4: Run** `pnpm --filter @gdud/db test` → PASS. **Step 5: Commit** — `feat(doch1): sheet import plan and apply`.

---

### Task 9: Web plumbing — access, data loaders, actions context, layout

**Files:**
- Create: `apps/web/src/lib/doch1/access.ts`, `apps/web/src/lib/doch1/data.ts`
- Create: `apps/web/src/app/(shell)/doch1/_actions/common.ts`
- Create: `apps/web/src/app/(shell)/doch1/layout.tsx`, `_components/doch1-nav.tsx`
- Modify: `apps/web/src/app/(shell)/doch1/page.tsx` (temporary: redirect, replaced in Task 13)
- Modify: `apps/web/src/lib/action-result.ts` (map `GD001`, `GD002`)
- Modify: `apps/web/next.config.ts` (`experimental.serverActions.bodySizeLimit: "4mb"` — Vercel functions reject request bodies over 4.5 MB; this round's sheet is 2.1 MB)

**Interfaces:**
- Consumes: `can`, `scopesFor` (`@gdud/auth`); schema (Task 5); core types (Task 3).
- Produces:

```ts
// access.ts
export interface Doch1Access {
  isAdmin: boolean;            // battalion-wide doch1 admin (or super admin)
  canView: boolean;            // any doch1 role
  /** units the user reports for: companies (company_user) and platoons (platoon_commander); admin → all active round companies */
  reportScopes: string[];
  canReport: (unitId: string) => boolean; // admin/company_user/platoon_commander covering unitId
}
export function doch1Access(s: Pick<Session, "user" | "parents">): Doch1Access;
// data.ts — every loader takes the RLS tx
export interface RoundVM { id: string; name: string; startsOn: Day; endsOn: Day; lockAt: string; reminderAt: string; sendAt: string }
export async function loadActiveRound(tx: Tx): Promise<RoundVM | null>;
export async function loadStatuses(tx: Tx, roundId: string, opts?: { includeInactive?: boolean }): Promise<StatusDef[]>;
export interface MemberVM extends ReportMember { name: string; roleTitle: string | null; platoonName: string | null; sheetRow: number | null }
export async function loadMembers(tx: Tx, roundId: string, units: UnitNode[]): Promise<MemberVM[]>; // only active round companies; company/platoon via placement()
export async function loadDays(tx: Tx, roundId: string, days: Day[]): Promise<Map<Day, Map<string, string>>>;
export async function loadRoundCompanies(tx: Tx, roundId: string): Promise<Array<{ unitId: string; active: boolean; appFrom: Day | null }>>;
// _actions/common.ts
export interface Doch1Ctx { s: Session; access: Doch1Access; round: RoundVM }
export async function doch1Ctx(): Promise<Doch1Ctx | null>; // null: no session/module or no active round
export const NO_PERMISSION, NO_ROUND; export function revalidateDoch1(): void; // revalidatePath("/doch1", "layout")
export const dayParam: z.ZodType<Day>;   // z.string().refine(isDay, "תאריך לא תקין")
```

- Counting a day always uses `loadStatuses(…, { includeInactive: true })`, so days that point at a replaced status version still count by the flags they had (Task 10 versioning). The status sheet shows active statuses only.
- `dbErrorMessage`: `GD001` → `"היום כבר ננעל לעריכה. רק מנהל גדודי יכול לשנות אותו."`; `GD002` → `"התאריך מחוץ לסבב."`.
- Layout: `requireModule("doch1")`, `data-wide`, `Doch1Nav` with sections היום (`/doch1/today`), סקירה (`/doch1`, admin/viewer), לחטיבה (`/doch1/brigade`, admin), העתקה לגיליון (`/doch1/copy`, admin/company_user), ייבוא (`/doch1/import`, admin), הגדרות (`/doch1/settings`, admin). Pattern: `logistics-nav.tsx`. No active round: layout shows an empty state "אין סבב פעיל" with a link to settings for admins.

- [ ] **Step 1:** Implement the files. **Step 2: Run** `pnpm typecheck && pnpm lint` → PASS. **Step 3:** `pnpm dev`, open `/doch1` as a doch1 user → nav renders, no active round → empty state.
- [ ] **Step 4: Commit** — `feat(doch1): module shell, access and loaders`.

---

### Task 10: Settings — round, companies and the pilot switch, statuses

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/settings/page.tsx`, `settings/_components/{round-form,companies-table,status-editor}.tsx`
- Create: `apps/web/src/app/(shell)/doch1/_actions/settings.ts`
- Test: `packages/core/src/doch1/counting.test.ts` (one more case: `statusFlagsChanged`)

**Interfaces:**
- Consumes: Task 9.
- Produces (Server Actions, all battalion admin only, `ActionResult`):
  - `saveRound(_: ActionResult, fd: FormData)` — fields `id?`, `name` (1–40), `startsOn`, `endsOn`, `callUpOn?`, `reminderAt`, `lockAt`, `sendAt` (`HH:MM`), `active` (on/off). Activating one round deactivates the others in the same transaction.
  - `saveRoundCompany(fd)` — `unitId`, `active`, `appFrom?` (Day or empty).
  - `saveStatus(_: ActionResult, fd: FormData)` — `id?`, `name` (1–30), `color` (`#rrggbb`), `displayGroup` (1–30), `sheetValue` (1–30), `sortOrder`, the 8 flags, `active`. **Versioning:** when editing a status whose flags changed (`statusFlagsChanged(old, new)`) and that has any `doch1_days` row before today → insert a new row with the new values and `replacesId = old.id`, set the old row `active = false`, and move day rows with `day >= today` to the new id; otherwise update in place.
- Core addition: `statusFlagsChanged(a: StatusFlags, b: StatusFlags): boolean` in `counting.ts`.

UI: mockup screen 05 sections "גדוד וסבב", "דוח 1 היומי", "פלוגות ומסגרות", "סטטוסים". Companies table lists active company units (from `s.units`) with: active-this-round toggle, "דיווח באפליקציה מתאריך" date input (the pilot switch), and the number of round members. Status table columns: color dot, name, display group, sheet value, the 8 flags as checkboxes, active; "סטטוס חדש" row. Footnote from the mockup: "שינוי בהגדרות חל מהיום והלאה. ימים שכבר דווחו נשארים כמו שהם".

- [ ] **Step 1: Write the failing test** `statusFlagsChanged` (true when any of the 8 flags differ; false when only name/color/group differ). **Step 2: Run** → FAIL. **Step 3: Implement** the function, the actions and the page. **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5: Manual check** in `pnpm dev`: create the round 23.08.2026–10.12.2026, lock 10:00; set a company's pilot date; edit a used status's flag → a new version appears and the old one is inactive.
- [ ] **Step 6: Commit** — `feat(doch1): settings`.

---

### Task 11: Import screen

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/import/page.tsx`, `import/_components/import-flow.tsx` (client)
- Create: `apps/web/src/app/(shell)/doch1/_actions/import.ts`

**Interfaces:**
- Consumes: `readWorkbook`, `parseSheet`, `planSheetImport`, `applySheetImport` (Tasks 7–8).
- Produces:
  - `previewSheetImport(fd: FormData): Promise<ActionOutcome<SheetImportPlan>>` — `file` (File, `.xlsx`, ≤ 3.9 MB, else `"הקובץ גדול מדי (עד 3.9MB)"` / `"צריך קובץ xlsx"`; the client checks the size before sending too), `mappings` (JSON string, zod-validated as `Partial<ImportMappings>`). Battalion admin only. Runs `planSheetImport` inside `withUser`; it only reads.
  - `applySheetImport(fd: FormData): Promise<ActionOutcome<ImportCounts>>` — same fields; the client re-sends the same `File` with the final mappings. Parses again, applies in one `withUser` transaction, `revalidateDoch1()`.
- The file is never written to disk or storage.

UI flow (client): choose file → "תצוגה מקדימה" → counts card (חיילים חדשים / עודכנו / ימים שנכתבו / נוקו / דולגו בפלוגת הפיילוט), warnings list, "not in the file" list, then one select per `MappingQuestion` (tab → company or "להתעלם"; platoon → existing / "ליצור מחלקה" / "ברמת הפלוגה"; status → existing / "ליצור סטטוס") → "עדכון תצוגה" re-runs preview with the answers → "ייבוא" enabled when `questions.length === 0`. After import: result counts and a link to settings › statuses ("כדאי לעבור על צבעים, קבוצות ודגלים של סטטוסים חדשים").

- [ ] **Step 1:** Implement. **Step 2: Run** `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 3: Manual check** with `references/doch1/דוח 1 - סבב שביעי.xlsx` on a local database only (never commit, never upload elsewhere): preview lists `גדודי` as ignore, platoon questions appear, import completes, a second import reports zero changes.
- [ ] **Step 4: Commit** — `feat(doch1): import the round sheet from the app`.

---

### Task 12: דוח 1 של היום — company and platoon screen

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/today/page.tsx`
- Create: `apps/web/src/app/(shell)/doch1/today/_components/{today-list,status-sheet,bulk-sheet,undo-toast}.tsx` (client)
- Create: `apps/web/src/app/(shell)/doch1/_actions/days.ts`
- Modify: `packages/ui/src/tzelem.css` (add `tz-sheet`, `tz-scrim`, `tz-grabber`, `tz-option`, `tz-toast`, `tz-action-bar` using existing tokens only; the toast uses `--ink` at 92% opacity)

**Interfaces:**
- Consumes: Tasks 2–3, 9.
- Produces (Server Actions; each: `doch1Ctx` → `access.canReport(unit of the person)` → zod → `withUser`; RLS + guard trigger enforce again; errors through `actionError`):
  - `setDayStatus(input: { personId: string; day: Day; statusId: string | null }): Promise<ActionResult>` — `null` deletes the entry. Upsert on `(personId, day)`.
  - `fillFromYesterday(input: { unitId: string; day: Day }): Promise<ActionOutcome<{ filled: number }>>` — members under `unitId`, `fillFromYesterdayPlan`.
  - `bulkSetStatus(input: { personIds: string[] /* 1..200 */; from: Day; to: Day /* ≤ 31 days */; statusId: string }): Promise<ActionOutcome<{ written: number; overwritten: number; undo: DayWrite[] }>>` — `planBulkWrite`.
  - `restoreDays(undo: DayWrite[] /* ≤ 6200 */): Promise<ActionResult>` — `statusId: null` rows are deleted, others upserted.

Page (`?unit=<companyOrPlatoonId>&day=<Day>`; default unit = first of `reportScopes`, default day = `israelToday`), matching mockup screen 07:
- Header `"{unit} · {hebrewDayLabel}"`; unit pills when the user has more than one scope (admin: all active round companies).
- Status card: `"{reported} מתוך {roster} דיווחו"`, red `"{missing} חסרים"` chip, progress bar; footnote `"הדוח ננעל ב-{lockAt}"`; button `"השלמת {n} חסרים לפי אתמול"` (hidden when 0). Complete state: green check `"{roster} מתוך {roster} דיווחו · הדוח מוכן"`.
- For a company scope: per-platoon completion rows (`"מחלקה 2 · 18/20"`) above the list.
- Search (name or role) and segmented filter: הכל / חסרים {n} / one item per display group.
- Soldier list grouped by platoon: avatar, name, role, status chip (status color; `"חסר"` danger chip when none). Tap → status sheet: `"סטטוס להיום · אתמול: {name|—}"`, a 3-column grid of the active statuses (sortOrder), the current one ringed; choosing saves and closes (optimistic, reverted with the error message on failure).
- Multi-select mode ("בחירה") → action bar `"{n} נבחרו"` → bulk sheet (screen 08): ימים היום / מחר / טווח (from–to), status tiles, warning `"יחליף {overwritten} ימים מתוכננים"` (computed client-side from loaded days for the visible range), button `"עדכון {n} חיילים · {status} · {days} ימים"`. After success: undo toast `"עודכנו {written} ימים"` with **ביטול** (calls `restoreDays`), auto-hides after 8 s.
- Locked (`!isDayWritable` for this user): list read-only, banner `"היום ננעל ב-{lockAt}. רק מנהל גדודי יכול לשנות."`.
- Viewer: read-only, no buttons.

- [ ] **Step 1: Implement** the actions, CSS classes and components.
- [ ] **Step 2: Run** `pnpm test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 3: Manual check** on a phone-width viewport (375 px): as a platoon commander only the platoon shows; set a status; fill from yesterday; group update over 3 days then undo → the earlier planned values return and the previously empty days are empty again; set the round's lock to a past time → the list turns read-only, and a submit from a page opened before the change shows the GD001 message ("היום כבר ננעל…").
- [ ] **Step 4: Commit** — `feat(doch1): today's report for companies and platoons`.

---

### Task 13: Battalion overview

**Files:**
- Modify: `apps/web/src/app/(shell)/doch1/page.tsx` (replace the Task 9 redirect)
- Create: `apps/web/src/app/(shell)/doch1/_components/{kpi-row,composition-bar,company-table}.tsx`
- Create: `apps/web/src/app/(shell)/doch1/_actions/reminders.ts`

**Interfaces:**
- Consumes: `summarize`, `missingMembers` (Task 3), loaders (Task 9).
- Produces: `requestReminder(unitId: string): Promise<ActionResult>` — battalion admin; inserts `doch1_reminder_requests` (`roundId`, `unitId`); message on success `"התזכורת תישלח תוך כמה דקות"`.

Page: company_user / platoon_commander without admin or viewer role → `redirect("/doch1/today")`. Otherwise (mockup screens 01 / 06):
- Footnote `"{hebrewDayLabel} · עודכן {israelClock(now)}"`; company pills (כל הגדוד + each active round company with roster count) select the scope via `?unit=`.
- KPI row: בסד״כ (`"מתוך {roster} ברשימה"`), one card per display group (`"{pct}% מהסד״כ"`), חסרי דיווח (danger).
- Composition bar: groups + חסרי דיווח, widths as % of `reported + missing`, zero segments hidden, legend with counts.
- Company table: פלוגה, ברשימה, בסד״כ, one column per display group, חסרי דיווח (danger chip when > 0), השלמת דיווח (bar + %, ok color when ≥ 90%), and a "תזכורת" button per company with missing > 0 (admin only). Footer row "סה״כ גדוד". Rows link to `/doch1/today?unit=<company>`.
- "דורש טיפול היום": one row per company with missing > 0 → expands to the missing soldiers' names (admin/viewer only).

- [ ] **Step 1:** Implement. **Step 2: Run** `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 3: Manual check** after an import: totals match the sheet's `דוחות` section B for the same day (rows, missing, on duty).
- [ ] **Step 4: Commit** — `feat(doch1): battalion overview`.

---

### Task 14: Brigade report preview

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/brigade/page.tsx`, `brigade/_components/brigade-preview.tsx` (client)
- Create: `apps/web/src/app/(shell)/doch1/_actions/brigade.ts`

**Interfaces:**
- Consumes: `brigadeReportText` (Task 4), `summarize` (Task 3).
- Produces: `logBrigadeCopy(input: { day: Day; content: string; partial: boolean }): Promise<ActionResult>` — battalion admin; inserts `doch1_brigade_log`.

Page (mockup screen 10), battalion admin only (`notFound()` otherwise): `?day=` (default today). Server builds `BrigadeInput` (battalion name = the `battalion` unit's name). Client: toggles "פירוט לפי פלוגה" (on) and "שמות החסרים" (off) recompute the text locally with `brigadeReportText`; orange warning `"עדיין חסרים {missing} דיווחים. הדוח יסומן כחלקי עד שכל הפלוגות ישלימו"` when missing > 0; preview card (`white-space: pre-line`, `*bold*` lines rendered bold); button **העתקה לוואטסאפ** copies the text (`navigator.clipboard.writeText`, fallback: select the text) then calls `logBrigadeCopy`; button **שיתוף** uses `navigator.share` when available. Pilot note under the buttons: `"בזמן הפיילוט הדוח הרשמי נשלח מהגיליון — השוו את המספרים"`. Footnote `"כל העתקה נשמרת ביומן הדוחות עם השעה והשולח"`.

- [ ] **Step 1:** Implement. **Step 2: Run** `pnpm typecheck && pnpm lint` → PASS. **Step 3: Manual check:** text matches the format test in Task 4 for real data; a copy writes a log row.
- [ ] **Step 4: Commit** — `feat(doch1): brigade report preview`.

---

### Task 15: Copy to sheet

**Files:**
- Create: `apps/web/src/app/(shell)/doch1/copy/page.tsx`, `copy/_components/copy-column.tsx` (client)

**Interfaces:**
- Consumes: `sheetColumnLines` (Task 4), loaders (Task 9).

Page: admin or company_user. `?unit=<company>&day=` (company_user: own company only). Rows: the company's members whose `sheetTab` belongs to that company, value = status `sheetValue` or `""` when missing. Shows `"שורות {firstRow}–{firstRow + lines.length - 1} בלשונית {tab}"`, a read-only textarea with the lines, **העתקה** button (clipboard, fallback select), a warning when the day still has missing soldiers (`"{missing} חסרים — יודבקו כתאים ריקים"`), and a list "לא בגיליון" with the app-only soldiers (`notInSheet`) to add by hand.

- [ ] **Step 1:** Implement. **Step 2: Run** `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 3: Manual check:** paste into a copy of the sheet's company tab at the shown row on the day's column → every row lines up with the right soldier.
- [ ] **Step 4: Commit** — `feat(doch1): copy a day back to the sheet`.

---

### Task 16: Push notifications — PWA, subscription, sender

**Files:**
- Modify: `apps/web/package.json` (`web-push: 3.6.7`, dev `@types/web-push`)
- Create: `apps/web/src/app/manifest.ts`, `apps/web/public/sw.js`
- Modify: `apps/web/src/proxy.ts` (CSP: add `worker-src 'self'` and `manifest-src 'self'`; add `/sw.js`, `/manifest.webmanifest`, `/api/doch1/cron` to `PUBLIC_PATHS`)
- Create: `apps/web/src/app/(shell)/doch1/_actions/push.ts`, `apps/web/src/app/(shell)/doch1/_components/push-toggle.tsx` (client)
- Create: `apps/web/src/lib/doch1/push.ts` (server-only sender)
- Modify: `.env.example` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…`, `CRON_SECRET`)

**Interfaces:**
- Produces:
  - `saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<ActionResult>` — any doch1 member; `endpoint` must be `https://`, ≤ 1000 chars; upsert by endpoint (delete + insert own).
  - `removeSubscription(endpoint: string): Promise<ActionResult>`.
  - `sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url: string }): Promise<"ok" | "gone" | "error">` — `web-push`; HTTP 404/410 → `"gone"`.
- `sw.js`: `push` → `showNotification(title, { body, data: { url }, dir: "rtl", lang: "he" })`; `notificationclick` → focus an open client on the same origin or `clients.openWindow(url)`. Only same-origin relative URLs are opened.
- `manifest.ts`: `name "מערכת הגדוד"`, `short_name "גדוד"`, `start_url "/doch1/today"`, `display "standalone"`, `dir "rtl"`, `lang "he"`, colors from Tzelem `--primary` / `--ground`, icon `/icon.svg` (`sizes "any"`, `type "image/svg+xml"`).
- `PushToggle` (on the today screen header): hidden if `!("serviceWorker" in navigator && "PushManager" in window)`; on iPhone/iPad Safari not in standalone mode → text `"כדי לקבל תזכורות: שיתוף ← הוספה למסך הבית, ואז לפתוח מהאייקון"`; else button `"קבלת תזכורות"` → register `/sw.js`, `Notification.requestPermission()`, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, `saveSubscription`; subscribed state shows `"תזכורות פעילות"` with a plain "ביטול" button.

- [ ] **Step 1:** Implement. **Step 2: Run** `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 3: Manual check** (local, with VAPID keys from `pnpm dlx web-push generate-vapid-keys`): enable reminders in Chrome → a row in `doch1_push_subscriptions`; the browser console shows no CSP violation for the worker or manifest.
- [ ] **Step 4: Commit** — `feat(doch1): web push subscription`.

---

### Task 17: Reminder job

**Files:**
- Create: `packages/core/src/doch1/reminders.ts`; Test: `packages/core/src/doch1/reminders.test.ts`
- Create: `apps/web/src/app/api/doch1/cron/route.ts`
- Create: `apps/web/src/lib/doch1/reminder-job.ts` (server-only; the only `systemDb()` use in this module)
- Create: `docs/DOCH1.md` (operations: env vars, VAPID, cron setup, import steps, pilot steps)

**Interfaces:**
- Consumes: `summarize`/`missingMembers` (Task 3), `israelToday`/`israelClock` (Task 2), `sendPush` (Task 16).
- Produces:

```ts
export interface ReminderRecipient { userId: string; scopeUnitId: string; scopeName: string }
/** One message per (user, scope) with missing > 0. */
export function reminderMessages(recipients: readonly ReminderRecipient[], missingByUnit: ReadonlyMap<string, number>):
  Array<{ userId: string; unitId: string; missing: number; title: string; body: string; url: string }>;
// title "דוח 1", body "{scopeName} · חסרים {n} דיווחים להיום", url "/doch1/today?unit={unitId}"
export function isDue(now: Date, reminderAt: string, alreadySentToday: boolean): boolean;
// reminder-job.ts
export async function runReminderJob(now: Date): Promise<{ daily: number; requests: number; gone: number }>;
```

- Route `GET /api/doch1/cron`: requires `Authorization: Bearer ${CRON_SECRET}` (constant-time compare; 401 otherwise; 500 if `CRON_SECRET` unset), runs `runReminderJob(new Date())`, returns the counts as JSON, `Cache-Control: no-store`.
- `runReminderJob`: active round; recipients = active app users with a doch1 `company_user` / `platoon_commander` membership whose unit is (or is under) an active round company, and at least one push subscription; missing per scope unit = `missingMembers` of the members under that unit for today. **Daily:** if `isDue(now, reminderAt, …)` and no `doch1_reminder_log` row with `kind = 'daily'` for (round, today, user) → send and log (unique index makes a double run harmless). **Requests:** for each unprocessed `doch1_reminder_requests` row, send to recipients whose scope is that company or under it, log with `kind = 'request'`, set `processed_at`. Subscriptions that return `"gone"` are deleted.
- `docs/DOCH1.md` — the cron trigger (runs on any Vercel plan):

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

- [ ] **Step 1: Write the failing tests**

```ts
it("isDue only after the reminder time and once a day", () => {
  expect(isDue(new Date("2026-10-22T05:59:00Z"), "09:00", false)).toBe(false); // 08:59 Israel
  expect(isDue(new Date("2026-10-22T06:01:00Z"), "09:00", false)).toBe(true);
  expect(isDue(new Date("2026-10-22T06:01:00Z"), "09:00", true)).toBe(false);
});
it("messages carry counts and unit names, never soldiers, and skip complete units", () => {
  const msgs = reminderMessages(
    [{ userId: "u1", scopeUnitId: "plsr", scopeName: "פלס״ר" }, { userId: "u2", scopeUnitId: "plnt", scopeName: "פלנ״ט" }],
    new Map([["plsr", 9], ["plnt", 0]]),
  );
  expect(msgs).toEqual([{ userId: "u1", unitId: "plsr", missing: 9, title: "דוח 1", body: "פלס״ר · חסרים 9 דיווחים להיום", url: "/doch1/today?unit=plsr" }]);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** core functions, the job and the route. **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5: Manual check:** `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/doch1/cron` with the reminder time set a minute in the past → a notification arrives on the subscribed browser; a second call sends nothing; without the header → 401.
- [ ] **Step 6: Commit** — `feat(doch1): scheduled and on-demand reminders`.

---

### Task 18: Go-live for the pilot

**Files:**
- Modify: `docs/SECURITY.md` (new section "Approvals")
- Modify: `packages/core/src/modules.ts` (doch1 `status: "live"`)
- Modify: `references/README.md` (list `sheet-structure.md`, `mockup/`, and that the xlsx stays local)
- Modify: `docs/DOCH1.md` (pilot runbook)

- [ ] **Step 1:** `docs/SECURITY.md` → add: `## Approvals` / `- doch1 (דוח 1), 2026-10-22: ביטחון מידע approval for soldier names, personal numbers and phones, outposts, standby readiness and vehicle numbers carries over from the approved Google Sheet "דוח 1 - סבב שביעי". Recorded by the battalion admin.`
- [ ] **Step 2:** `docs/DOCH1.md` pilot runbook: create the round in settings → import the sheet → review statuses (colors, display groups, `counts_in_sadak`, `across_border`) → set the pilot company's "דיווח באפליקציה מתאריך" → invite its clerk and platoon commanders (admin › users, roles `company_user` / `platoon_commander`) → each enables reminders (iPhone: add to home screen first) → daily: clerk copies the day into the sheet; admin re-imports the sheet when the battalion views should be current.
- [ ] **Step 3:** Set doch1 `status: "live"`; update `references/README.md`.
- [ ] **Step 4: Run** the full gate: `pnpm test && pnpm typecheck && pnpm lint && pnpm build` → all PASS.
- [ ] **Step 5:** Confirm `git status` (once the repo exists) does not list any `.xlsx` or `.csv`.
- [ ] **Step 6: Commit** — `feat(doch1): open the module for the pilot`.
