# Adding a department module

Example: porting the logistics app.

1. **Registry** — the module is already listed in `packages/core/src/modules.ts`. Adjust its roles if needed and set `status: "live"` when it ships. A brand-new module also needs its id added there; `module_id` in Postgres is generated from that list (run `pnpm db:generate`).

2. **Tables** — create `packages/db/src/schema/logistics.ts`, export it from `schema/index.ts`.
   - Reference shared data, never copy it: `personId → people.id`, `unitId → units.id`.
   - Call `.enableRLS()` on every table.
   - `pnpm db:generate --name logistics` creates the table migration.

3. **Security migration** — `pnpm --filter @gdud/db exec drizzle-kit generate --custom --name logistics_security`, then write in it:
   - `grant select, insert, update, delete on public.<table> to authenticated;` (only what's needed)
   - policies using `app.has_role('logistics', array['admin'], unit_id)` / `app.sees_unit(unit_id)` / `app.has_module('logistics')`
   - the `app.audit` and `app.touch_updated_at` triggers (copy from `0001_security.sql`)

4. **RLS tests** — add a `describe("logistics")` block to `packages/db/test/rls.test.ts`: what an admin, a company-scoped viewer and a user from another company can and can't do. `pnpm test` must pass.

5. **Pages** — `apps/web/src/app/(shell)/logistics/…`. Start every page with `const s = await requireModule("logistics")`, read/write with `withUser(s.claims, tx => …)`, and use `can(s.user, "logistics", ["admin"], unitId, s.parents)` to decide what to show. Mutations are Server Actions that check `can()` and validate with zod before writing.

6. **Data import** — a one-off script in `packages/db/scripts/` that reads the old Google Sheet and fills the new tables (people first, then module data). Run locally with `MIGRATION_DATABASE_URL`.

   **Logistics import** — clear it with ביטחון מידע first (docs/SECURITY.md): the sheet holds real names and personal numbers. The mapping lives in `packages/db/src/logistics-sheet/` (read → diff → apply) and is shared by the app and the CLI. It never creates, edits or deactivates soldiers (דוח 1 owns `people`) and never creates units: a row for a soldier the app doesn't have is listed as "couldn't read" until דוח 1 adds them.

   **In the app (logistics admins)** — `/logistics/import`, for a battalion-wide logistics admin or a super admin (entry row on the logistics home). Download the Google Sheet as Microsoft Excel (.xlsx, up to 4 MB), upload it, choose the tabs, and review the preview line by line: *ישתנו* (sheet differs; ticked — the sheet wins), *חדשים* (ticked), *רק באפליקציה* (unticked — nothing is removed unless ticked), *לא נקראו* (never imported; says what to fix). Apply writes the ticked lines in one transaction under RLS and logs one "ייבוא מהגיליון" row in `/logistics/log`. The file is parsed in memory and not stored; apply re-reads it and aborts ("האפליקציה השתנתה…") if the app changed since the preview. Safe to repeat: re-importing the same file finds nothing new.

   **CLI (developers)** — `packages/db/scripts/import-logistics.ts` reads CSV exports and applies **new rows only**, so it never overwrites or removes app data.
   1. Create the companies under the battalion in `/admin/units`, and make sure the soldiers exist (דוח 1).
   2. In the spreadsheet, for each of `Dropdowns`, `תקן ציוד משלים`, `טבלת צ`, `אלפון גדודי`, `גדודי`, `אפסון`: open the tab → File → Download → CSV. Put the files in one folder **outside the repo** (`*.csv` is git-ignored anyway). The default names (`<spreadsheet> - <tab>.csv`) are fine; a missing tab is skipped.
   3. Dry run — prints the full diff (new / changed / only in the app / couldn't read), writes nothing:
      `pnpm --filter @gdud/db exec tsx scripts/import-logistics.ts <folder> --dry-run`
   4. Run without `--dry-run` to add the new rows (one transaction). Changes and app-only rows are printed but not applied — use the in-app import for those.
   5. Delete the CSV folder.

   Mapping: `טבלת צ` status נשקייה תקין → `ok`, תקול → `broken`, חטיבה → `brigade`; חתום or blank carries no condition (who holds a serial comes from `גדודי`; a serial's item type is never changed by an import). `גדודי` = one open assignment per row, matched by צ׳; a different holder is a transfer; kit text "3 מחסניות, רצועה" is parsed into lines. Soldiers are matched by personal number (formatting ignored), else through the `אלפון גדודי` name → personal number, else by a unique full name. An `אפסון` row with an out-date is released; אפסון rows match an app row by soldier + צ׳ + item + day (sheet dates are read as Israel time, whatever the server's zone). A serial or item that appears only in `גדודי` / `טבלת צ` is created and flagged. The same צ׳ twice: the first row wins, the later one is listed.

7. **Reference code** — put the old app's code in `references/<module>/` so behaviour can be compared during the port.
