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

7. **Reference code** — put the old app's code in `references/<module>/` so behaviour can be compared during the port.
