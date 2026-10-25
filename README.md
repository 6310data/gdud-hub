# gdud-hub

One web app for the whole battalion. Each department (לוגיסטיקה, דוח 1, ניהול פלוגה, מחלקת קשר, …) is a **module** inside it. All modules share one login, one permission system and one database, so they can read each other's data (one soldier record, one unit tree).

**Stack:** Next.js 16 (App Router) on Vercel · Supabase (Postgres, Google sign-in) · Drizzle ORM · Tzelem design system · pnpm workspaces + Turborepo.

```
apps/web/                  the Next.js app (one domain, one route per module)
  src/app/(shell)/         signed-in area: home, /admin, /logistics, /doch1, /company/[unit], /kesher
  src/app/login, auth/     Google sign-in, callback, sign-out
  src/proxy.ts             session refresh, redirect to /login, per-request CSP
  src/lib/session.ts       requireSession() / requireModule() — load the user + memberships
packages/core/             module registry (MODULES), unit tree helpers — no dependencies
packages/auth/             can(user, module, roles, unit) — permission checks for the UI
packages/db/               Drizzle schema, migrations (incl. RLS policies), withUser(), RLS tests
packages/ui/               Tzelem tokens + tz- CSS classes + React components
references/                old Apps Script / platoon-web code to port (not built or deployed)
```

## How permissions work

- **Sign-in:** Google only. The account's email must be invited first (`/admin`), otherwise the user lands on "אין לך עדיין גישה".
- **Membership:** a user has a role per module, optionally limited to a unit (a company covers its platoons and teams). No unit = whole battalion.
- **Super admin:** sees and edits everything. Created with the bootstrap script.
- **Enforced twice:** `can()` in the app decides what to show; Postgres Row-Level Security (in `packages/db/migrations/0001_security.sql`) decides what data actually comes back. Every user query goes through `withUser(claims, tx => …)`, which runs as the `authenticated` role with the user's JWT.

## First-time setup

1. **Supabase project** (region: Frankfurt / `eu-central-1`).
   - Authentication → Sign In / Providers → enable **Google** (needs a Google Cloud OAuth client; redirect URI is shown on that screen). Disable Email and every other provider.
   - Authentication → URL Configuration → Site URL = your Vercel URL; add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` to Redirect URLs.
2. `cp .env.example .env` and fill in the values.
3. Install and migrate:
   ```bash
   corepack enable
   pnpm install
   pnpm db:migrate
   pnpm db:bootstrap-admin you@gmail.com "Your Name" "שם הגדוד"
   ```
4. `pnpm dev` → http://localhost:3000 → sign in with that Google account → `/admin` to add companies and invite people.

## Deploy (Vercel)

- Import the GitHub repo. **Root Directory:** `apps/web` (Vercel detects pnpm + Turborepo).
- Functions run in `fra1` (`apps/web/vercel.json`), next to the Supabase database. Keep them in the same region: every request makes several DB round trips.
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (transaction pooler). Not `MIGRATION_DATABASE_URL`.
- Settings → Deployment Protection → enable for Preview deployments.
- Migrations are run by you (`pnpm db:migrate`), not by Vercel builds.

## Everyday commands

| | |
|---|---|
| `pnpm dev` | run the app |
| `pnpm test` | permission unit tests + RLS tests (in-memory Postgres, no setup needed) |
| `pnpm typecheck` / `pnpm lint` | |
| `pnpm db:generate` | create a migration after changing `packages/db/src/schema` |
| `pnpm db:migrate` | apply migrations to Supabase |

## Adding a department module

See [docs/ADDING_A_MODULE.md](docs/ADDING_A_MODULE.md). Security rules for every change: [docs/SECURITY.md](docs/SECURITY.md).
