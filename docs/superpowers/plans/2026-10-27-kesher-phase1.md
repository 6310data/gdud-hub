# מחלקת קשר — Phase 1 (read-only on imported data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The communications department (`kesher`) gets its own app in gdud-hub, filled from the Google Sheet "פיזור ושליטה מחלקת קשר" by a repeatable preview-and-tick import, with read-only screens (סקירה, פלוגות, צ׳ במערכת, ציוד משלים, יומן) so the department can compare the app with the sheet while the sheet stays the record.

**Architecture:** A new `kesher` module like logistics. Value lists and pure helpers (`expandKit`, check status, labels) in `@gdud/core/kesher`. Tables in `packages/db/src/schema/kesher.ts`; grants, policies (set form, `app.unit_scope('kesher')`) and guard triggers in `migrations/00NN_kesher_security.sql`, tested on PGlite. The sheet mapping in `packages/db/src/kesher-sheet/` (read → diff → apply, inside the admin's `withUser` transaction). The xlsx reader, the client-safe import helpers and the preview UI move from logistics to shared places (`packages/db/src/sheet-import/`, `apps/web/src/components/sheet-import/`) and both imports use them. Pages in `apps/web/src/app/(shell)/kesher/`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase Postgres + RLS, Drizzle 0.45, PGlite + Vitest 4, zod 4, Tzelem (`@gdud/ui`), `read-excel-file` (already a dependency), `write-excel-file` (dev, test files only).

**Spec:** `docs/superpowers/specs/2026-10-27-kesher-design.md` (read it first; the Import section documents the sheet column by column). UI: `references/Kesher/mockup/kesher.html` (serve the repo root, open `/references/Kesher/mockup/kesher.html`). Old app: `references/Kesher/Code.js.txt`.

**Out of this plan (Phase 2, see the end):** החתמה, זיכוי, קליטה, שיוך בתוך הפלוגה, דוח צ׳, editing quantities and תקן, ניהול צ׳, settings page, exports, push notifications.

## Global Constraints

- Read `CLAUDE.md`, `docs/SECURITY.md`, `docs/ADDING_A_MODULE.md` before Task 1.
- Hebrew UI, RTL, Tzelem only (`tz-` classes, tokens in `packages/ui/src/tzelem.css`, no new colors). צ׳ and vehicle numbers via `<Serial>` / `tz-serial`.
- Roles (spec "Users and roles"): `admin` (battalion-wide = everything), `user` (battalion or a company). A company-scoped `admin` gets no more than `user`. `kesherAccess(s)` in `apps/web/src/lib/kesher/access.ts` exposes `isAdmin` (battalion admin) and the company scope.
- Every page under `(shell)/kesher`: `requireModule("kesher")`, then `kesherAccess` for finer checks. Every request-time DB access: `withUser(session.claims, tx => …)`. Never `systemDb()` in request code.
- Soldiers are `people` rows, never free text. Import matches a name only on an exact, unique `searchKey` of the full name among the **active** soldiers of the row's company subtree. None or several → "לא נקראו" (several: the admin may pick one in the preview, for that import only). The serial still imports without a holder.
- The import **never writes `people` or `units`**. An unknown company (e.g. עיט before it is added in `/admin/units`) → error line "הפלוגה X לא קיימת — יש להוסיף אותה בניהול מערכת".
- Never imported: `הרשאות אתר` (emails, access codes), the email columns of `יומן חתימות` (K) and `דוחות צ׳` (D), forms and filters. No cell value in logs or in an event's details.
- Upload: `.xlsx` only, ≤ 4 MB, parsed in memory, never stored. Apply re-reads the file, re-diffs inside the transaction, aborts if the preview fingerprint changed.
- Defaults: "new" and "change" lines ticked; "appOnly" lines unticked; "error" lines not selectable.
- No new npm dependencies.
- `pnpm test && pnpm typecheck && pnpm lint` green at the end of every task that touches code. Commit per task on the branch.

## Review Focus

1. **Company scope** — a company user never reads another company's holders, checks, check lines or soldier-linked events; serials, stock, items and kits are readable by every kesher member. Tests in Task 3.
2. **A holder can't point at the wrong soldier** — the holder trigger rejects an inactive soldier or one outside the company's subtree, on insert and whenever a person column changes; a company user may change only the holder columns. Tests in Task 3.
3. **Moving a serial drops its holder row** (location fix or import): a holder never sits on a company the serial isn't on. Test in Task 3.
4. **Re-importing the same file finds nothing new** (idempotent), including the log, reports and check lines. Test in Task 6.
5. **Exact soldier matching only** — unmatched, ambiguous, another company's soldier and an inactive soldier all become error lines; the serial line still applies. Tests in Task 5.

---

## File Structure

```
packages/core/src/kesher.ts                       value lists, labels, expandKit(), checkStatus()       (new)
packages/core/src/kesher.test.ts                  expandKit / checkStatus tests                          (new)
packages/core/src/modules.ts                      kesher roles wording, status "live"
packages/db/src/schema/kesher.ts                  tables                                                 (new)
packages/db/migrations/00NN_kesher.sql            generated
packages/db/migrations/00NN_kesher_security.sql   grants, policies, triggers, settings row              (custom)
packages/db/src/sheet-import/                     shared by the logistics and kesher imports             (new)
  xlsx.ts      readWorkbook(), cellText(), SheetFileError        (moved from logistics-sheet/xlsx.ts)
  preview.ts   MAX_FILE_BYTES, checkUploadFile(), carryTicks(), LineGroup, PreviewLine (client-safe)
  index.ts
packages/db/src/logistics-sheet/xlsx.ts           readXlsx() on top of readWorkbook()
packages/db/src/kesher-sheet/                     (new)
  sheet.ts     tab names, readKesherBook(), cell(), dates
  types.ts     ChangeOp, ChangeLine, SheetDiff, ApplyResult
  state.ts     loadState()
  people.ts    soldier matching
  diff.ts      diffKesher() + fingerprint
  apply.ts     applyKesher(), summarizeImport()
  index.ts
packages/db/test/rls.test.ts                      describe("kesher")
packages/db/test/import-kesher.test.ts            (new)
apps/web/src/components/sheet-import/             change-table.tsx, import-flow.tsx (moved, generic)
apps/web/src/components/page-parts.tsx            PageHeader, Panel, Kpi, SmallTile, Empty (moved from logistics ui.tsx)
apps/web/src/lib/kesher/access.ts, data.ts        (new)
apps/web/src/app/(shell)/kesher/                  layout, loading, page (סקירה), companies/[unit], serials, stock, log,
                                                  import, _actions/sheet-import.ts, _components/
apps/web/src/app/(shell)/(hub)/kesher/page.tsx    removed (the "coming soon" placeholder)
docs/ADDING_A_MODULE.md                           "Kesher import" paragraph
```

---

### Task 1: Core — value lists, helpers, roles

**Files:**
- Create: `packages/core/src/kesher.ts`, `packages/core/src/kesher.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/modules.ts`

**Interfaces:**
- `KESHER_ITEM_KINDS = ["serial", "bulk"]`, `KESHER_LOCATIONS = ["warehouse", "company", "none"]`, `KESHER_EVENT_KINDS = ["sign", "credit", "intake", "assign", "stock_edit", "serial_edit", "kit_edit", "check", "import", "legacy"]` with `KESHER_EVENT_LABEL`, `KESHER_LOCATION_LABEL`.
- `expandKit(counts: ReadonlyMap<string, number>, kits: ReadonlyMap<string, readonly {item: string; qty: number}[]>): Map<string, number>` — cascade, depth ≤ 4 (as the mockup's `expandKit`).
- `checkStatus(last: {at: Date; total: number; found: number} | null, now: Date, staleDays: number): {kind: "none" | "missing" | "stale" | "ok"; missing: number; days: number}` — the overview chip rule (לא הוגש / N לא נמצאו / ישן · N ימים / תקין).
- `kesherLogKind(action: string): {kind; backdated}` — the old log's action text ("אתר — החתמה", "אתר — זיכוי (מלאי חלקי) · תאריך 01/09/2026", "אתר — שיוך בפלוגה", "אתר — קליטה ראשונית", plain "החתמה"/"זיכוי") → kind, unknown → `legacy`.
- modules.ts: kesher `user` description "צפייה, שיוך חותמים בפלוגה ודוח צ׳"; `status: "live"`.

- [ ] Step 1: tests for `expandKit` (מגבר cascade, depth limit on a cycle), `checkStatus` (each kind), `kesherLogKind` (each action, backdated suffix, unknown).
- [ ] Step 2: implement; `pnpm --filter @gdud/core test` PASS.
- [ ] Step 3: commit `feat(kesher): core value lists and helpers`.

### Task 2: Schema and table migration

**Files:** Create `packages/db/src/schema/kesher.ts`; modify `schema/index.ts`; generate `migrations/00NN_kesher.sql` with `pnpm db:generate --name kesher`.

Tables exactly as the spec's Data table: `kesher_items`, `kesher_kit_items`, `kesher_serials`, `kesher_holders`, `kesher_stock` (unique `item_id, unit_id` nulls not distinct), `kesher_checks`, `kesher_check_lines`, `kesher_events` (bigserial, `sheet_key` unique where not null), `kesher_settings` (`id = 1`). `.enableRLS()` on each; checks for name/serial format, `unit_id is not null` ⇔ `location = 'company'`, `qty` ranges, text lengths (roles/frame ≤ 40).

- [ ] Step 1: write the schema; generate; read the SQL (nulls-not-distinct must be in it — hand-edit if drizzle-kit drops it).
- [ ] Step 2: `pnpm --filter @gdud/db test` (existing tests still pass with the new migration), typecheck.
- [ ] Step 3: commit `feat(kesher): tables`.

### Task 3: Security migration and RLS tests

**Files:** Create `migrations/00NN_kesher_security.sql` (`drizzle-kit generate --custom --name kesher_security`); modify `packages/db/test/rls.test.ts`.

Policies per the spec's Security table, set form (`(select app.unit_scope('kesher')) is null or unit_id = any((select app.unit_scope('kesher'))::uuid[])`). Grants: no `anon`; `kesher_serials` update only `(location, unit_id, vehicle, notes)`; holders update only `(holder_person_id, holder_role, frame, signer_person_id, signer_role, signed_at)`; checks/lines/events insert + select only. Triggers (security definer where they read across RLS):
- `kesher_items_kind_guard` — serials need a `serial` item, stock and kit children a `bulk` item; a serial's `unit_id` must be a `company` unit.
- `kesher_kit_guard` — no self-reference, no cycle (recursive walk).
- `kesher_serials_moved` — after update of `unit_id`: delete the holder row if it no longer matches.
- `kesher_serials_delete_guard` — no delete while a holder row exists.
- `kesher_holders_fill` — before insert: `unit_id` from the serial (null → error); `signed_by` = current user.
- `kesher_holders_guard` — person columns: active soldier in the company subtree, on insert and on change; non-battalion-admins may change only holder columns.
- `kesher_stock_guard` — warehouse below 0 only while `warehouse_tracked` is off.
- `kesher_checks_fill` — `reporter_name` from `app_users` when `by_user` is set; `notified_at` = now() for imported (`sheet_key`) rows, else null.
- `kesher_check_lines_guard` — an app-filed check's line must be a serial on that company now.
- `kesher_events_actor` — `actor_name` from `app_users`.
- `app.audit` on every table, `app.touch_updated_at` on the mutable ones; settings row `id = 1` inserted.

- [ ] Step 1: tests (`describe("kesher")`): battalion admin, battalion user, two company users of פלס״ר, a פלנ״ט user, a user from another module, no membership. Cases: catalogue/serials/stock visible to all members, nothing to others; only battalion admin writes catalogue/serials/stock (company admin can't); company user sees own holders only; sets holder from own company, not another company's soldier, not an inactive one; can't change signer columns; two users of the same company see the same rows; checks only for own company and not with another company's צ׳; `notified_at` can't be set by a user; a צ׳ on a company can't be deleted; moving a serial drops the holder; a kit cycle is rejected; events scoped; audit rows written.
- [ ] Step 2: write the migration until the tests pass; whole suite PASS.
- [ ] Step 3: commit `feat(kesher): security — grants, policies, triggers, RLS tests`.

### Task 4: Shared sheet-import pieces

Move rather than copy (spec): `logistics-sheet/xlsx.ts`'s reader and the client-safe parts of `logistics-sheet/preview.ts` to `packages/db/src/sheet-import/`; the logistics files re-export so `@gdud/db/logistics-sheet` keeps its API. Web: `logistics/import/change-table.tsx` and `import-flow.tsx` → `apps/web/src/components/sheet-import/`, generic over the module (actions, tab list, default tabs, kind labels, back/log links); the logistics import page passes its own. Generic logistics `ui.tsx` pieces → `apps/web/src/components/page-parts.tsx` (logistics re-exports). `PreviewLine` gains optional `choices` (ambiguous soldier) and the flow an `onPick`.

- [ ] Step 1: move; `@gdud/db` exports `./sheet-import` and `./sheet-import/preview`.
- [ ] Step 2: existing logistics import tests PASS unchanged; typecheck; lint.
- [ ] Step 3: commit `refactor(import): share the xlsx reader and the preview UI`.

### Task 5: Kesher sheet — read and diff

**Files:** Create `packages/db/src/kesher-sheet/{sheet,types,state,people,diff,index}.ts`, `packages/db/test/import-kesher.test.ts`; modify `packages/db/package.json` exports.

- `readKesherBook(data)` → `{ tabs: {name, key, rows, note?}[], sheets }`: keys `pizur` (פיזור צ כללי, header row 1), `companies` (each company tab: header row 2, recognised by name matching a unit or by column F header "צ׳"; collapsed into one tab entry), `general` (כללי, header row 2), `kit` (תקן ציוד משלים, header row 2), `log` (יומן חתימות), `reports` (דוחות צ׳), `checks` (בדיקות צ׳). The "not imported" tabs listed greyed with the reason. Error cells (`#N/A`, `#REF!`, `#VALUE!` …) read as empty.
- `diffKesher(tx, sheets, tabs, picks)` → `SheetDiff` (lines + identical counts + fingerprint). Ops: `item.add`, `item.brigade`, `serial.add`, `serial.update` (location / company / vehicle / notes), `signer.set`, `holder.set`, `stock.set` (per item, changed cells only), `kit.add`, `kit.qty`, `kit.remove` (appOnly, unticked), `log.add` (one line), `checks.add` (one line: reports + their lines + synthetic checks for בדיקות צ׳ rows without a report). Device type differs → error. A צ׳ in a company tab that פיזור puts elsewhere → error. Unknown company → error. Duplicate צ׳ → first wins, later row error.
- `picks`: `Record<"<unitId>|<searchKey(name)>", personId>` for ambiguous names; only a candidate id is accepted.

- [ ] Step 1: tests with invented data (built with `write-excel-file`): every tab read; unmatched / ambiguous (with and without a pick) / other-company / inactive soldier; unknown company row is an error and creates nothing; device type differs; company-tab צ׳ on another company; כללי columns found by header name, `מלאי כללי` mismatch warning; kit cycle → error.
- [ ] Step 2: implement until PASS.
- [ ] Step 3: commit `feat(kesher): read and diff the sheet`.

### Task 6: Kesher sheet — apply

**Files:** Create `packages/db/src/kesher-sheet/apply.ts`; modify the test file.

- `applyKesher(tx, diff, selected)` — dependency order (items → serials → signers → holders → stock → kit → log → checks), blocked lines listed, `expectRow` on every update; `summarizeImport()` (counts and tab names only).
- [ ] Step 1: tests: apply all → state as expected (holders with and without signer, stock rows, kits, events with `person_name`, checks marked notified with lines); **re-diff of the same file → zero new / change lines**; a moved serial in a second file drops its holder; unticking a serial blocks its holder line; apply runs as the kesher admin through RLS (`runAsUser`).
- [ ] Step 2: implement until PASS.
- [ ] Step 3: commit `feat(kesher): apply the sheet import`.

### Task 7: Module shell, access, import page

**Files:** Create `apps/web/src/lib/kesher/access.ts`, `apps/web/src/app/(shell)/kesher/{layout,loading}.tsx`, `kesher/import/page.tsx`, `kesher/_actions/sheet-import.ts`; delete `(hub)/kesher/page.tsx`.

- Layout per the mockup: name "מחלקת קשר", sub "פיזור צ׳, החתמות ומלאי", mark `antenna`, search → `/kesher/serials?q=`, `current="tinted"`; nav סקירה · פלוגות · צ׳ במערכת · ציוד משלים · יומן; group פעולות: ייבוא מהגיליון (battalion admin only — the other actions arrive in Phase 2); phone tabs סקירה, פלוגות, צ׳, משלים + עוד.
- Import actions: inspect / preview / apply as logistics (battalion kesher admin or super admin), one `import` event per apply.
- [ ] Step 1: build; typecheck, lint.
- [ ] Step 2: commit `feat(kesher): module shell and sheet import page`.

### Task 8: Read-only screens

**Files:** Create `apps/web/src/lib/kesher/data.ts`, `kesher/page.tsx` (סקירה), `kesher/companies/page.tsx` (→ first company in scope), `kesher/companies/[unit]/page.tsx`, `kesher/serials/page.tsx`, `kesher/stock/page.tsx`, `kesher/log/page.tsx`, `kesher/_components/*`.

- סקירה: פיזור הצ׳ bar + KPIs (במחסן / על הפלוגות / ללא שיוך / נראו בעין ב־N ימים), companies table (צ׳, משויכים meter, last report chip + date, ציוד משלים total), חתימות אחרונות (8), דורש טיפול (ללא שיוך, report status per company in scope, holders who left the company or the list, holdings without a signer), ציוד משלים בחוסר במחסן (hidden when not tracked). No action buttons yet.
- פלוגה: pills (companies in scope, with counts), header, last-report strip with the missing צ׳, segmented צ׳ (grouped by device type, done/total, warning chip on holders no longer in the company, last check) / ציוד משלים (חתומים / לפי תקן / פער). Search `?q=`.
- צ׳ במערכת: search (צ׳, device, holder, frame — holders only in scope), pills הכל / במחסן / בפלוגות / ללא שיוך / לא נמצאו בדוח, table (150 rows max with a note), inspector `?sel=` with details and history (events + check lines).
- ציוד משלים: segmented מלאי לפי פלוגה (grouped by category; warehouse + companies, total, brigade qty with "מעל") / תקן (cards per parent, read-only ×qty).
- יומן: segmented יומן חתימות / דוחות צ׳; search, company and kind filters; 100 per page with "הקודמים".
- [ ] Step 1: build; typecheck, lint.
- [ ] Step 2: commit `feat(kesher): read-only screens`.

### Task 9: Docs, final checks, PR

- [ ] Step 1: `docs/ADDING_A_MODULE.md` — kesher import paragraph.
- [ ] Step 2: `pnpm test && pnpm typecheck && pnpm lint` green.
- [ ] Step 3: browser: the mockup next to the built pages (the pages need a migrated database and a Google sign-in; where that isn't available, compare the markup/classes against the mockup and say so in the PR).
- [ ] Step 4: push the branch, open the PR to `main` with what is in and what is left for Phase 2.

---

## Phase 2 (follow-up, not built here)

1. **Daily-work actions** — החתמה (`/kesher/sign`), זיכוי (`/kesher/credit`), קליטה ראשונית (`/kesher/intake`), שיוך בתוך הפלוגה (inline and group edit on the company page), דוח צ׳ (`/kesher/check`, with localStorage drafts), quantities and תקן editing on `/kesher/stock`, ניהול צ׳ in the serials inspector, `/kesher/settings` (`warehouse_tracked`, `check_stale_days`, catalogue). Shared `PersonPicker` moved to `apps/web/src/components/`.
2. **Notifications** — `doch1_push_subscriptions` → `push_subscriptions`, shared push code and toggle, `/api/cron` running each module's job; "דוח צ׳ with צ׳ not found" to battalion admins and the daily stale reminder to company users.
3. **Exports** — פיזור צ׳ כללי and רשימת ציוד פלוגתית, print page (PDF) and Excel (`writeWorkbook`).
4. **Admin** — the kesher role picker in `/admin/users` offers battalion or a company only.
