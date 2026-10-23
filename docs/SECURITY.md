# Security rules

The app holds personal data about soldiers. Check with the unit's ביטחון מידע before importing real data, and keep operational details (exact outposts, force readiness) out unless explicitly approved.

## Layers

| Layer | What protects it |
|---|---|
| Who can sign in | Google OAuth only + invite list (`app_users`). `app.link_auth_user()` only accepts provider `google` with a verified email. |
| Who sees which rows | Postgres RLS on every table; all user queries run through `withUser()` as role `authenticated`. Tested in `packages/db/test/rls.test.ts`. |
| What the UI offers | `can()` from `@gdud/auth` + `requireModule()`. Convenience only — never the only check. |
| Writes | Server Actions: `can()` check → zod validation → `withUser()` write (RLS checks again). |
| History | `audit_log`, written by triggers with the acting user. Readable by battalion core admins. |
| Browser | Nonce-based CSP, HSTS, `X-Frame-Options: DENY`, no third-party scripts, fonts self-hosted. |
| Supply chain | pnpm `minimumReleaseAge` (7 days), Dependabot, lockfile committed. |

## Rules for every change

- New table → `.enableRLS()` + explicit policies + explicit `GRANT`s + audit trigger + RLS tests. New tables get **no** access by default (default privileges are revoked).
- Never grant anything to `anon`.
- Never use `systemDb()` in a request handler. It bypasses RLS; it's for import scripts only.
- Never put `DATABASE_URL`, `MIGRATION_DATABASE_URL` or the Supabase secret/service key in client code or in a `NEXT_PUBLIC_` variable.
- Don't store a field (ת״ז, מס׳ אישי, address…) unless a feature actually needs it.
- Redirect targets go through `safeNextPath()`.

## Approvals

- doch1 (דוח 1), 2026-10-22: ביטחון מידע approval for soldier names, personal numbers and phones, outposts, standby readiness and vehicle numbers carries over from the approved Google Sheet "דוח 1 - סבב שביעי". Recorded by the battalion admin.

## Accounts to protect (2-step verification on all)

GitHub, Vercel, Supabase, the Google account(s) of super admins.

## Before go-live checklist

- [ ] Supabase: only the Google provider enabled; Redirect URLs list only your domains
- [ ] Supabase → Advisors → Security Advisor: no warnings
- [ ] Supabase → Database → Backups checked; nightly `pg_dump` job set up if the plan's backups aren't enough
- [ ] Vercel: Deployment Protection on for previews; env vars set for Production only where needed
- [ ] GitHub: repo private, secret scanning + Dependabot alerts + CodeQL (Settings → Code security) enabled; branch protection on `main` requiring CI
- [ ] Super admin list reviewed; users from the previous סבב deactivated
