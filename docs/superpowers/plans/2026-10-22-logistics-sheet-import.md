# Logistics in-app sheet import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A battalion logistics admin (or super admin) uploads the logistics Google Sheet as `.xlsx` at `/logistics/import`, picks tabs, reviews a line-by-line preview of what will change in the app, unticks lines, and applies — repeatedly, with the sheet staying the official record.

**Architecture:** The sheet mapping moves out of `packages/db/scripts/logistics-import.ts` into `packages/db/src/logistics-sheet/` and is split into *read* (CSV / xlsx → `Sheets`), *diff* (`Sheets` + DB state → `ChangeLine[]`) and *apply* (selected lines → writes, in the caller's transaction). The CLI and three Server Actions both use it. Nothing is stored between preview and apply: the browser re-sends the file, the server re-diffs inside the apply transaction and aborts if the preview fingerprint changed.

**Tech Stack:** Next.js 16 Server Actions, Drizzle + Postgres RLS (`withUser`), PGlite + vitest for tests, `read-excel-file` (new), `write-excel-file` (new, dev only, to build test files), Tzelem UI (`@gdud/ui`, `tz-` classes), zod.

**Spec:** `docs/superpowers/specs/2026-10-22-logistics-sheet-import-design.md`

## Global Constraints

- Hebrew UI, RTL, Tzelem only (`tz-` classes, tokens in `packages/ui/src/tzelem.css`, no new colors). צ׳, personal numbers, phones via `<Serial>`.
- Who: `logisticsAccess(session).isStockAdmin` (battalion-level `logistics/admin`, super admin passes `can()`). Page: `requireModule("logistics")` then `notFound()` if not `isStockAdmin`. Actions re-check.
- Every request-time DB access through `withUser(session.claims, tx => …)`. Never `systemDb()` in request code.
- The import **never writes `people` or `units`**. Soldier missing in the app → error line `החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1`. Unknown company/platoon → error line.
- Serial item type is never changed; a difference → error line `סוג הפריט שונה מהאפליקציה — לתיקון ידני`.
- Defaults: "new" and "change" lines ticked; "appOnly" lines unticked; "error" lines not selectable.
- Upload: `.xlsx` only, ≤ `4 * 1024 * 1024` bytes; parsed in memory, never written to disk/storage/logs; logs never contain cell values.
- Server Action body limit: `experimental.serverActions.bodySizeLimit: "4mb"` in `apps/web/next.config.ts`.
- New npm deps must satisfy pnpm `minimumReleaseAge: 10080` (7 days). Do not add the npm `xlsx` package.
- One `logistics_events` row per applied import, kind `sheet_import`, label `ייבוא מהגיליון`, no soldier.
- The CLI applies **new** lines only; `--dry-run` prints the full diff.
- `pnpm test && pnpm typecheck && pnpm lint` green before done. Commits go to the worktree branch only; never push.

## Review Focus

1. **Re-importing the same file right after applying** must produce zero "new" and zero "change" lines (idempotent). Test in Task 5.
2. **Status `חתום` in טבלת צ** carries no condition: a signed-out serial that is `broken` in the app must not get a `broken → ok` change line. Test in Task 3.
3. **The same צ׳ twice** (twice in טבלת צ, or twice in גדודי for different soldiers): first row wins, the later row is an error line naming the first row. Tests in Tasks 3 and 4.
4. **Personal-number formatting** (`12-34567` in the sheet vs `1234567` in the app) must resolve to the same soldier. Test in Task 4.
5. **App changed between preview and apply** (e.g. someone signs out a צ׳): the fingerprint differs and nothing is written. Test in Task 4 (fingerprint changes) and Task 8 step 3 (the action aborts, checked by hand).

---

## File Structure

```
packages/db/src/logistics-sheet/
  sheet.ts     SHEET_NAMES, SheetKey, SheetRow, Sheets, cell(), statusToCondition(), parseSheetDate()   (moved)
  csv.ts       parseCsv(), toSheetRows()                                                        (moved)
  xlsx.ts      readXlsx(), cellText()                                                           (new)
  types.ts     LineGroup, LineKind, ChangeOp, ChangeLine, SheetDiff, ApplyResult, PreviewLine   (new)
  state.ts     loadState(): DB snapshot used by diff                                             (new)
  diff.ts      diffLogistics() + per-tab differs + fingerprint                                   (new)
  apply.ts     applyLogistics()                                                                  (new)
  index.ts     public exports
packages/db/scripts/logistics-import.ts      → shrinks to readSheets() (CSV folder) + formatDiff()
packages/db/scripts/import-logistics.ts      CLI: read → diff → apply "new" lines
packages/db/test/pglite.ts                   createTestDb() shared by the two import test files (new)
packages/db/test/logistics-sheet.test.ts     diff/apply/xlsx tests (new)
packages/db/test/import-logistics.test.ts    updated for the new CLI behaviour
packages/core/src/logistics.ts               + "sheet_import" event kind
packages/db/migrations/0004_*.sql            generated: add enum value
apps/web/next.config.ts                      bodySizeLimit
apps/web/src/app/(shell)/logistics/_actions/sheet-import.ts   inspect / preview / apply actions
apps/web/src/app/(shell)/logistics/import/page.tsx            guard + shell
apps/web/src/app/(shell)/logistics/import/import-flow.tsx     client: upload → tabs → preview → result
apps/web/src/app/(shell)/logistics/import/change-table.tsx    preview table (generic, reusable by דוח 1)
apps/web/src/app/(shell)/logistics/page.tsx                   entry row for isStockAdmin
docs/ADDING_A_MODULE.md                                       "Logistics import" section
```

`packages/db/package.json` gains `"./logistics-sheet": "./src/logistics-sheet/index.ts"` in `exports`.

---

### Task 1: Move the sheet helpers into `src/logistics-sheet` and share the PGlite test setup

Pure move; behaviour unchanged.

**Files:**
- Create: `packages/db/src/logistics-sheet/sheet.ts`, `csv.ts`, `index.ts`; `packages/db/test/pglite.ts`
- Modify: `packages/db/scripts/logistics-import.ts`, `packages/db/test/import-logistics.test.ts`, `packages/db/package.json`

**Interfaces:**
- Produces (from `@gdud/db/logistics-sheet`): `SHEET_NAMES`, `type SheetKey`, `interface SheetRow { row: number; cells: string[] }`, `type Sheets = Partial<Record<SheetKey, SheetRow[]>>`, `cell(r: SheetRow, col: number): string` (now exported), `nameKey(s: string): string` (exported), `statusToCondition(status: string): Condition | undefined`, `parseSheetDate(text: string): Date | undefined`, `parseCsv(text: string): string[][]`, `toSheetRows(rows: string[][]): SheetRow[]` — **note the signature change**: it now takes parsed rows so xlsx can reuse it; callers do `toSheetRows(parseCsv(text))`.
- Produces (test): `createTestDb(): Promise<{ db: PgliteDb; ids: { bat: string; plsr: string; plsr1: string; plnt: string } }>` — PGlite + `SUPABASE_SHIM_SQL` + migrations + the battalion / two companies / one platoon that `import-logistics.test.ts` creates today.

- [ ] **Step 1:** Move the code, switch `import-logistics.test.ts` to `createTestDb()` and to the new imports.
- [ ] **Step 2:** Run `pnpm --filter @gdud/db test` — expected: all existing tests PASS unchanged.
- [ ] **Step 3:** Run `pnpm --filter @gdud/db typecheck` — expected: no errors.
- [ ] **Step 4:** Commit `refactor(logistics): move sheet helpers to src/logistics-sheet`.

---

### Task 2: Read `.xlsx` files

**Files:**
- Create: `packages/db/src/logistics-sheet/xlsx.ts`, `packages/db/test/logistics-sheet.test.ts`
- Modify: `packages/db/package.json` (dep `read-excel-file`, devDep `write-excel-file`), `index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface XlsxTab { name: string; key: SheetKey | null; rows: number }   // rows = data rows (header excluded, blank rows dropped)
  export interface XlsxBook { tabs: XlsxTab[]; sheets: Sheets }                   // sheets only for recognised tabs
  export async function readXlsx(data: Uint8Array): Promise<XlsxBook>
  export function cellText(v: unknown): string
  export class SheetFileError extends Error {}                                     // thrown for anything that isn't a readable xlsx
  ```
- Tab recognition: `name.normalize("NFC").trim() === SHEET_NAMES[key]`.
- `cellText`: `null/undefined → ""`; string → as is; number → `String(n)`; boolean → `"TRUE"/"FALSE"`; `Date` → `dd/MM/yyyy HH:mm` from the **UTC** fields (xlsx dates carry no zone; the library returns wall time as UTC), dropping ` 00:00` when the time is midnight. `parseSheetDate` must accept the result.
- Use the `read-excel-file` Node entry; check the installed version's README for how to read every sheet by name (API changed across majors).

- [ ] **Step 1: Write the failing tests** in `logistics-sheet.test.ts` (`describe("readXlsx")`), building the file in the test with `write-excel-file` (Node entry, to a Buffer):
  ```ts
  it("lists every tab, recognises the logistics ones, and reads rows", async () => {
    const book = await readXlsx(await xlsx({
      "טבלת צ": [["קטגוריה","פריט","צ","סטטוס"], ["נשק","M4 קצר","7710432","נשקייה תקין"], ["","","",""]],
      "אפסון": [["פלוגה","שם מלא","מספר אישי","פריט","צ","תאריך אפסון","תאריך הוצאה מאפסון"],
                ['פלס"ר',"דני כהן",1234567,"M4 קצר","100", new Date(Date.UTC(2026,8,1)), null]],
      "הערות": [["x"]],
    }));
    expect(book.tabs).toEqual([
      { name: "טבלת צ", key: "serials", rows: 1 },
      { name: "אפסון", key: "storage", rows: 1 },
      { name: "הערות", key: null, rows: 0 },
    ]);
    expect(book.sheets.serials![0]).toEqual({ row: 2, cells: ["נשק","M4 קצר","7710432","נשקייה תקין"] });
    expect(book.sheets.storage![0]!.cells.slice(2, 7)).toEqual(["1234567","M4 קצר","100","01/09/2026",""]);
  });
  it("rejects a file that is not xlsx", async () => {
    await expect(readXlsx(new TextEncoder().encode("a,b\n1,2"))).rejects.toBeInstanceOf(SheetFileError);
  });
  it("cellText formats dates with time", () => {
    expect(cellText(new Date(Date.UTC(2026,7,15,10,30)))).toBe("15/08/2026 10:30");
  });
  ```
  (`xlsx(tabs)` is a small test helper over `write-excel-file`; `rows` counts non-blank data rows; `הערות` has only a header row so `rows: 0`.)
- [ ] **Step 2:** Run `pnpm --filter @gdud/db exec vitest run test/logistics-sheet.test.ts` — expected FAIL (`readXlsx` not exported).
- [ ] **Step 3:** `pnpm --filter @gdud/db add read-excel-file` and `pnpm --filter @gdud/db add -D write-excel-file`; implement `xlsx.ts`.
- [ ] **Step 4:** Run the same command — expected PASS.
- [ ] **Step 5:** Commit `feat(logistics): read the sheet from an xlsx download`.

---

### Task 3: Diff — types, state, soldiers, Dropdowns, טבלת צ, תקן ציוד משלים

**Files:**
- Create: `packages/db/src/logistics-sheet/types.ts`, `state.ts`, `diff.ts`
- Modify: `index.ts`, `packages/db/test/logistics-sheet.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type LineGroup = "new" | "change" | "appOnly" | "error";
  export type ChangeOp =
    | { t: "item.add"; name: string; category: string | null; subcategory: string | null; sku: string | null }
    | { t: "item.update"; itemId: string; category: string | null; subcategory: string | null; sku: string | null }
    | { t: "serial.add"; serial: string; itemName: string; category: string | null; condition: Condition }
    | { t: "serial.condition"; serialId: string; condition: Condition }
    | { t: "serial.delete"; serialId: string }
    | { t: "kit.add"; itemName: string; name: string; qty: number; sortOrder: number }
    | { t: "kit.remove"; kitItemId: string }
    | { t: "assignment.add"; serial: string; personId: string; notes: string | null; kit: KitLine[] }
    | { t: "assignment.transfer"; assignmentId: string; serial: string; personId: string; notes: string | null; kit: KitLine[] }
    | { t: "assignment.kit"; assignmentId: string; kit: KitLine[] }
    | { t: "assignment.return"; assignmentId: string }
    | { t: "storage.add"; personId: string; serial: string | null; itemName: string; storedAt: string; releasedAt: string | null } // ISO
    | { t: "storage.release"; storageId: string; releasedAt: string };                                                              // ISO
  export type LineKind = ChangeOp["t"] | "error";
  export interface ChangeLine {
    id: string;              // `${sheet}:${kind}:${key}` — key = normalised צ׳ / item name / item|kit name / storage key
    sheet: SheetKey; row: number | null;  // null for appOnly
    group: LineGroup; kind: LineKind;
    item: string | null; serial: string | null; personName: string | null;
    before: string | null; after: string | null;   // Hebrew display text, e.g. "תקין" → "תקול"
    message: string | null;                         // error reason or note
    selectable: boolean; defaultOn: boolean;
    dependsOn: string[];                            // ids of lines that must be applied first
    op: ChangeOp | null;                            // null for errors and non-removable appOnly
  }
  export interface SheetDiff { lines: ChangeLine[]; identical: Partial<Record<SheetKey, number>>; fingerprint: string }
  export type PreviewLine = Omit<ChangeLine, "op" | "dependsOn">;
  export function toPreview(line: ChangeLine): PreviewLine
  ```
- Produces (`diff.ts`): `export async function diffLogistics(tx: Tx, sheets: Sheets, tabs: readonly SheetKey[]): Promise<SheetDiff>` — only tabs in `tabs` produce lines; the `people` tab never produces lines but is always used (if present in `sheets`) as a name → personal-number lookup.
- `state.ts`: `loadState(tx: Tx): Promise<State>` — the maps `Importer.load()` builds today, plus: kit rows with ids, open assignment rows with id/notes/kit, storage rows with id, the set of serial ids that have **any** assignment or storage row (for "deletable").
- Soldier resolution (shared by Tasks 3–4): `normalizeSerial(pid)` → app person by personal number; else row name → אלפון row with that name → its personal number → app person; else exactly one app person with that `nameKey` name; else error `החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1`. Several app people with that name → error `יש כמה חיילים בשם "<name>" – הוסף מס׳ אישי`.
- Per-tab rules (this task):
  - **Dropdowns** (key: item name): missing → `item.add` (new); category/subcategory/sku differ → `item.update` (change, before/after = `"קטגוריה / תת קטגוריה / מק״ט"`). Name too long → error (reuse the CLI message). No appOnly. Unknown company in column A stays a non-blocking note: no line.
  - **טבלת צ** (key: normalised צ׳): missing צ׳ → `serial.add` (new; `dependsOn` the `item.add` line when the item is new in this diff; item missing from catalogue and from Dropdowns → `item.add` line created on the fly with message `פריט לא היה ב-Dropdowns`); item differs → error (Global Constraints text); status `חתום` → no condition comparison; other status maps via `statusToCondition`, unknown status → error; condition differs → `serial.condition` (change). Duplicate צ׳ later in the tab → error `הצ׳ מופיע פעמיים (גם בשורה N)`. appOnly: app serial not in tab → `serial.delete` if never assigned/stored (selectable, defaultOn false), else appOnly line with `op: null`, `selectable: false`, message `בשימוש – לא ניתן למחוק`.
  - **תקן ציוד משלים** (key: item|name): missing → `kit.add`; appOnly kit row → `kit.remove`. Unknown item → error.
  - `identical[tab]` counts rows that matched with no difference.

- [ ] **Step 1: Write the failing tests** (`describe("diffLogistics: catalogue and serials")`, DB from `createTestDb()` seeded with: item `M4 קצר`; serials `7710432` (M4 קצר, ok), `7710433` (M4 קצר, broken, has an open assignment to `דני כהן` pid `1234567`), `9990001` (M4 קצר, ok, never used), `9990002` (M4 קצר, ok, has a returned assignment)). Assertions, one `it` each:
  - new צ׳ with a new item → two lines `item.add` + `serial.add`, the second `dependsOn` the first, both `group: "new"`, `defaultOn: true`.
  - `נשקייה תקול` on `7710432` → one `serial.condition`, `before: "תקין"`, `after: "תקול"`, `group: "change"`.
  - `חתום` on `7710433` (app: broken) → **no line** for it; `identical.serials` counts it. *(Review Focus 2)*
  - `7710432` listed with item `M16` → `kind: "error"`, message `סוג הפריט שונה מהאפליקציה — לתיקון ידני`.
  - `7710432` twice → second row error `הצ׳ מופיע פעמיים (גם בשורה 2)`. *(Review Focus 3)*
  - `9990001` absent → appOnly `serial.delete`, `selectable: true`, `defaultOn: false`; `9990002` absent → appOnly, `selectable: false`, `op: null`.
  - tabs `["kit"]` only → no `serials:` lines at all even though `sheets.serials` is given.
- [ ] **Step 2:** Run `pnpm --filter @gdud/db exec vitest run test/logistics-sheet.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement `types.ts`, `state.ts`, the three differs in `diff.ts` (fingerprint can return `""` until Task 4).
- [ ] **Step 4:** Run the same command — expected PASS.
- [ ] **Step 5:** Commit `feat(logistics): diff catalogue, serials and kit against the app`.

---

### Task 4: Diff — גדודי, אפסון, fingerprint

**Files:**
- Modify: `packages/db/src/logistics-sheet/diff.ts`, `packages/db/test/logistics-sheet.test.ts`

**Interfaces:**
- Consumes: `diffLogistics`, `ChangeLine`, soldier resolution from Task 3.
- Produces: complete `diffLogistics`; `fingerprint` = sha256 hex (`node:crypto`) of `JSON.stringify` of `lines.map(l => [l.id, l.before, l.after, l.message])` sorted by id.
- Rules:
  - **גדודי** (key: normalised צ׳, column 6; soldier from columns 3/4; notes 7; kit text 8 via `parseKitText`). Missing צ׳ cell → error. Unknown soldier → error (Global Constraints text). צ׳ unknown to the app and to טבלת צ → `serial.add` line created on the fly (message `צ׳ לא היה בטבלת צ`), and the assignment `dependsOn` it. No open assignment → `assignment.add` (new). Open assignment to another soldier → `assignment.transfer` (change, before = current holder name, after = sheet holder name). Same soldier, kit differs → `assignment.kit` (change). Same צ׳ on two rows → later row error `הצ׳ מופיע פעמיים (גם בשורה N)`. appOnly: open assignment whose צ׳ is in no גדודי row → `assignment.return` (defaultOn false, `personName` = holder).
  - **אפסון** (key: personId|serialId-or-""|itemName|storedAt ms, as `storageKey` today). `0` or empty צ׳ = no serial. Bad dates / missing item / unknown צ׳ → error (reuse CLI messages). Unknown soldier → error. Row not in app → `storage.add` (new; error `צ׳ <s> כבר באפסון` if that serial has another open storage row in app or earlier in the tab). Row in app, app open, sheet has out-date → `storage.release` (change). App released but sheet open → error `שוחרר באפליקציה – לא ניתן להחזיר לאפסון`. appOnly: open app storage row matching no sheet row → `storage.release` with `releasedAt` = now (defaultOn false).

- [ ] **Step 1: Write the failing tests** (`describe("diffLogistics: assignments and storage")`, same seeded DB + person `רון לוי` pid `7654321`). One `it` each:
  - row `דני כהן, 12-34567, …, 7710433` (app holder דני, pid `1234567`) → no line; `identical.assignments === 1`. *(Review Focus 4)*
  - row for `7710433` with `רון לוי` → `assignment.transfer`, `before: "דני כהן"`, `after: "רון לוי"`.
  - row for `7710432` with `רון לוי` → `assignment.add`, `group: "new"`.
  - row with a soldier `שרה מזרחי` / pid `5555555` not in the app → error `החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1`; no `people` row is inserted (count unchanged).
  - same צ׳ for two soldiers → second row error. *(Review Focus 3)*
  - גדודי tab chosen and `7710433` absent → appOnly `assignment.return`, `defaultOn: false`.
  - storage: open app row + sheet row with out-date `20/08/2026` → `storage.release`; app-released row + sheet row without out-date → error.
  - fingerprint: same inputs twice → equal; after inserting one assignment directly in the DB → different. *(Review Focus 5)*
- [ ] **Step 2:** Run the test file — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS.
- [ ] **Step 5:** Commit `feat(logistics): diff assignments and storage, fingerprint the preview`.

---

### Task 5: Apply selected lines, under RLS, with the import event

**Files:**
- Create: `packages/db/src/logistics-sheet/apply.ts`; generated `packages/db/migrations/0004_*.sql`
- Modify: `packages/core/src/logistics.ts` (`LOGISTICS_EVENT_KINDS` += `"sheet_import"`, `EVENT_LABEL.sheet_import = "ייבוא מהגיליון"`), `index.ts`, `packages/db/test/logistics-sheet.test.ts`

**Interfaces:**
- Consumes: `SheetDiff`, `ChangeLine`, `ChangeOp`.
- Produces:
  ```ts
  export interface ApplyResult { applied: Record<LineGroup, number>; blocked: { id: string; reason: string }[] }
  export async function applyLogistics(tx: Tx, diff: SheetDiff, selected: ReadonlySet<string>): Promise<ApplyResult>
  export function summarizeImport(fileName: string, tabs: readonly SheetKey[], result: ApplyResult, unticked: number): string
  // → "<file> · לשוניות: טבלת צ, גדודי · חדשים 7 · שינויים 6 · הוסרו 1 · לא סומנו 3" (no cell values)
  ```
- Applies only lines that are in `selected`, `selectable`, and have an `op`. Ids in `selected` not in the diff are ignored.
- Order: `item.add, item.update, serial.add, serial.condition, kit.add, kit.remove, assignment.return, assignment.transfer, assignment.add, assignment.kit, storage.release, storage.add, serial.delete`.
- A line whose `dependsOn` contains an id not applied → not applied, added to `blocked` with reason `תלוי בשורה שלא סומנה`.
- `assignment.return` / `assignment.transfer` close the open assignment with `returnedAt = now()`, `returnedTo` left null (condition unchanged), and release that serial's open storage row (same as the app's return action). Transfer then inserts the new open assignment.
- Inserts in chunks of 500 like today. New items/serials are referenced by name/serial and resolved after their insert.
- `pnpm --filter @gdud/db generate` after the enum change produces the `ALTER TYPE … ADD VALUE 'sheet_import'` migration; commit it as generated.

- [ ] **Step 1: Write the failing tests** (`describe("applyLogistics")`). Run apply **as a battalion logistics admin** through `runAsUser` (create an `app_users` row + `memberships { module: "logistics", role: "admin", unitId: null }` like `rls.test.ts`):
  - selecting every `defaultOn` line applies them: the transfer leaves `7710433` returned from דני and open on רון; `serial.condition` sets `broken`; new serial + item exist.
  - **re-diff after apply with the same sheets → no `new` or `change` lines.** *(Review Focus 1)*
  - unticking the `item.add` line while selecting its `serial.add` → serial not created, `blocked` has the serial line's id.
  - selecting an appOnly `assignment.return` closes it; not selecting it leaves it open.
  - a company-scoped logistics admin (`unitId: plsr`) running apply on a `serial.add` → rejects (RLS).
  - `summarizeImport(...)` returns the exact string above for a fixed result.
  - inserting a `logistics_events` row `{ kind: "sheet_import" }` with no person as the battalion logistics admin succeeds.
- [ ] **Step 2:** Run — expected FAIL.
- [ ] **Step 3:** Add the event kind, run `pnpm --filter @gdud/db generate`, implement `apply.ts`.
- [ ] **Step 4:** Run `pnpm --filter @gdud/db test` — expected PASS (all db tests).
- [ ] **Step 5:** Commit `feat(logistics): apply selected sheet changes`.

---

### Task 6: Rebuild the CLI on diff + apply

**Files:**
- Modify: `packages/db/scripts/logistics-import.ts` (keep only `readSheets(folder)` → now via `toSheetRows(parseCsv(…))`, and `formatDiff(diff: SheetDiff, result: ApplyResult | null): string`; delete the old `Importer`, `importLogistics`, `ImportReport`, `formatReport`), `packages/db/scripts/import-logistics.ts`, `packages/db/test/import-logistics.test.ts`

**Interfaces:**
- Consumes: `diffLogistics`, `applyLogistics`, `SheetDiff`, `ApplyResult`.
- CLI flow: read CSVs → in one `db.transaction`: `diffLogistics(tx, sheets, every found tab)` → unless `--dry-run`, `applyLogistics(tx, diff, ids of lines with group "new" and defaultOn)` → print `formatDiff`. Usage text unchanged.

- [ ] **Step 1:** Update `import-logistics.test.ts`: seed `רון לוי` (pid `7654321`) as an existing person; replace report assertions with: first run creates items/serials/kit/assignments/storage for known soldiers; rows for `שרה מזרחי` are errors; **no `people` or `units` rows are created**; second run applies nothing; a sheet condition change is listed in `--dry-run` output but not applied by a normal run.
- [ ] **Step 2:** Run `pnpm --filter @gdud/db exec vitest run test/import-logistics.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @gdud/db test && pnpm --filter @gdud/db typecheck` — expected PASS.
- [ ] **Step 5:** Commit `refactor(logistics): CLI import uses the shared diff and applies new rows only`.

---

### Task 7: Server Actions

**Files:**
- Create: `apps/web/src/app/(shell)/logistics/_actions/sheet-import.ts`
- Modify: `apps/web/next.config.ts` (`experimental: { serverActions: { bodySizeLimit: "4mb" } }`), `packages/db/package.json` is already exporting `./logistics-sheet`

**Interfaces:**
- Consumes: `readXlsx`, `SheetFileError`, `diffLogistics`, `applyLogistics`, `summarizeImport`, `toPreview` from `@gdud/db/logistics-sheet`; `logisticsCtx`, `logEvents`, `revalidateLogistics`, `NO_PERMISSION`, `actionError`, `UserError`, `ActionOutcome` from the existing helpers.
- Produces:
  ```ts
  export async function inspectSheetFile(form: FormData): Promise<ActionOutcome<{ fileName: string; tabs: XlsxTab[] }>>
  export async function previewSheetImport(form: FormData): Promise<ActionOutcome<{ lines: PreviewLine[]; identical: Partial<Record<SheetKey, number>>; fingerprint: string }>>
  export async function applySheetImport(form: FormData): Promise<ActionOutcome<{ applied: Record<LineGroup, number>; blocked: { id: string; reason: string }[] }>>
  ```
- Form fields: `file` (File), `tabs` (repeated `SheetKey`, zod enum, ≥ 1; `people` allowed but produces nothing), `selected` (repeated string, ≤ 5000), `fingerprint` (64 hex chars).
- Shared private `readUpload(form)`: missing file → `בחרו קובץ`; not `.xlsx` → `יש להעלות קובץ Excel ‏(.xlsx)`; > 4 MB → `הקובץ גדול מדי (עד 4MB)`; `SheetFileError` → `הקובץ לא נקרא – ודאו שהורדתם אותו מ-Google Sheets כ-Microsoft Excel (.xlsx)`.
- Every action: `ctx = await logisticsCtx()`; `!ctx?.access.isStockAdmin` → `NO_PERMISSION`. Preview and apply run in `withUser(ctx.s.claims, …)`.
- Apply: inside one `withUser` transaction re-diff; fingerprint mismatch → `throw new UserError("האפליקציה השתנתה מאז התצוגה המקדימה — הציגו שוב")`; else `applyLogistics`, then `logEvents(tx, ctx.actorName, [{ kind: "sheet_import", details: summarizeImport(...) }])`; then `revalidateLogistics()`.
- Never log cell values; errors go through `actionError`.

- [ ] **Step 1:** Implement the actions and the config change.
- [ ] **Step 2:** Run `pnpm --filter @gdud/web typecheck && pnpm --filter @gdud/web lint` — expected: no errors.
- [ ] **Step 3:** Commit `feat(logistics): server actions for the sheet import`.

(The web app has no unit-test runner; the logic is covered by Tasks 2–5. The stale-fingerprint path is checked by hand in Task 8.)

---

### Task 8: Import page, preview table, entry point

**Files:**
- Create: `apps/web/src/app/(shell)/logistics/import/page.tsx`, `import-flow.tsx` (`"use client"`), `change-table.tsx`
- Modify: `apps/web/src/app/(shell)/logistics/page.tsx` (a row `ייבוא מהגיליון` → `/logistics/import`, only when `isStockAdmin`), `docs/ADDING_A_MODULE.md` ("Logistics import": in-app flow for admins; CLI = new rows only, never creates soldiers or platoons)

**Interfaces:**
- Consumes: the three actions from Task 7; `PreviewLine`, `XlsxTab`, `SheetKey`, `SHEET_NAMES`.
- `page.tsx`: `requireModule("logistics")`, `notFound()` unless `isStockAdmin`, `metadata = { title: "ייבוא מהגיליון" }`, renders `<ImportFlow />` inside the usual page frame (`PageHeader`, back link to `/logistics`).
- `ImportFlow` steps (one component, local state; the `File` object is kept in state and re-sent on each call):
  1. **upload** — the 3 instruction lines from the mockup, file input (`accept=".xlsx"`), on change → `inspectSheetFile`.
  2. **tabs** — list from `tabs`: recognised tabs with a checkbox (default ticked: `serials`, `assignments`, `storage`; `people` labelled `לאיתור מספר אישי בלבד`), unrecognised tabs greyed `לא נתמך`; the note `הגיליון לא משתנה. הייבוא רק מעדכן את האפליקציה לפי הגיליון.`; button `הצג מה ישתנה` → `previewSheetImport`.
  3. **preview** — tab chips with change counts; summary (חדשים / ישתנו / רק באפליקציה / לא נקראו / זהים); `<ChangeTable>`; sticky footer `N שינויים מסומנים מתוך M · K שורות לא ייובאו` with `חזרה` and `ייבא N שינויים` → `applySheetImport`. A stale-fingerprint error shows the message and a `הצג שוב` button that re-runs preview.
  4. **result** — applied counts, blocked lines with reasons, link `ללוג` → `/logistics/log`.
- `ChangeTable` props: `{ lines: PreviewLine[]; selected: ReadonlySet<string>; onToggle(id: string): void }`. Sections in this order with these headers: `ישתנו`, `חדשים`, `רק באפליקציה`, `לא נקראו`. Columns: checkbox (none for unselectable), change badge (`Chip` tones: new → `ok`, change → `broken`, appOnly → `brigade`, error → danger style from tokens), sheet row, item, צ׳ in `<Serial>`, `before ← after` with `before` struck through, or `message`. Error lines for the same unknown soldier are grouped under one sub-row per soldier name with a count. Unticked rows are dimmed.

- [ ] **Step 1:** Implement page, flow, table, home row, docs.
- [ ] **Step 2:** Run `pnpm test && pnpm typecheck && pnpm lint` from the repo root — expected: all green.
- [ ] **Step 3: Manual check** (needs `.env` with a dev database and a battalion logistics admin): `pnpm --filter @gdud/web dev`, open `/logistics/import`, upload an xlsx built from the test fixture, confirm: tabs listed with counts; preview groups and defaults match the spec; unticking a line reduces the footer count; apply → result and a `ייבוא מהגיליון` row in `/logistics/log`; apply again with the same file → preview shows no new/changed lines; open preview, change a serial's condition in another tab, apply → stale message, nothing written; a company-level admin gets 404 on `/logistics/import` and no home row. If no dev database is available, say so in the hand-off instead of claiming this passed.
- [ ] **Step 4:** Commit `feat(logistics): import page with preview and per-line selection`.
