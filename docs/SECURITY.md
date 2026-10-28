# Security rules

The app holds personal data about soldiers. Check with the unit's ביטחון מידע before importing real data, and keep operational details (exact outposts, force readiness) out unless explicitly approved.

## Layers

| Layer | What protects it |
|---|---|
| Who can sign in | Google OAuth only + invite list (`app_users`). `app.link_auth_user()` only accepts provider `google` with a verified email. A soldier may also join (`app.request_join`: personal number + last 4 phone digits, same answer whether or not they match, 5 attempts a day); only a company admin's approval (`app.approve_join`) creates the account. |
| Who sees which rows | Postgres RLS on every table; all user queries run through `withUser()` as role `authenticated`. Tested in `packages/db/test/rls.test.ts`. |
| What the UI offers | `can()` from `@gdud/auth` + `requireModule()`. Convenience only — never the only check. |
| Writes | Server Actions: `can()` check → zod validation → `withUser()` write (RLS checks again). |
| History | `audit_log`, written by triggers with the acting user. Readable by battalion core admins. doch1 users get one soldier's rows (their days, round fields and people row) through `app.doch1_person_log()`, only for a soldier they already see (`0013_doch1_person_log`). |
| Browser | Nonce-based CSP, HSTS, `X-Frame-Options: DENY`, no third-party scripts, fonts self-hosted. |
| Supply chain | pnpm `minimumReleaseAge` (7 days), Dependabot, lockfile committed. |

## Rules for every change

- New table → `.enableRLS()` + explicit policies + explicit `GRANT`s + audit trigger + RLS tests. New tables get **no** access by default (default privileges are revoked).
- Never grant anything to `anon`.
- Never use `systemDb()` in a request handler. It bypasses RLS; it's for import scripts only.
- Never put `DATABASE_URL`, `MIGRATION_DATABASE_URL` or the Supabase secret/service key in client code or in a `NEXT_PUBLIC_` variable.
- Don't store a field (ת״ז, מס׳ אישי, address…) unless a feature actually needs it.
- Redirect targets go through `safeNextPath()`.
- A cookie-authenticated `POST` route handler (not a Server Action) checks `sameOrigin()` (`apps/web/src/lib/progress-stream.ts`) and the same permission as the action it replaces, before reading the body.

## Approvals

- doch1 (דוח 1), 2026-10-22: ביטחון מידע approval for soldier names, personal numbers and phones, outposts, standby readiness and vehicle numbers carries over from the approved Google Sheet "דוח 1 - סבב שביעי". Recorded by the battalion admin.
- kesher (מחלקת קשר), 2026-10-27: ביטחון מידע approval for which soldier (from the דוח 1 list) holds which communications device, kesher roles and frames, device serial numbers, company holdings and vehicle numbers, carried over from the approved Google Sheet "פיזור ושליטה מחלקת קשר". The sheet's emails and access codes are not imported. Confirmed by the user in the kesher design (docs/superpowers/specs/2026-10-27-kesher-design.md).

- company (ניהול פלוגה): **not approved yet.** Phase 1 (self-join and אני) opens the platform to every soldier and shows them their own gear, דוח 1 status and details; ביטחון מידע must approve before it goes live (docs/superpowers/specs/2026-10-28-company-design.md, "Security and privacy").

## Accounts to protect (2-step verification on all)

GitHub, Vercel, Supabase, the Google account(s) of super admins.

## Before go-live checklist

- [ ] Supabase: only the Google provider enabled; Redirect URLs list only your domains
- [ ] Supabase → Advisors → Security Advisor: no warnings
- [ ] Supabase → Database → Backups checked; nightly `pg_dump` job set up if the plan's backups aren't enough
- [ ] Vercel: Deployment Protection on for previews; env vars set for Production only where needed
- [ ] GitHub: repo private, secret scanning + Dependabot alerts + CodeQL (Settings → Code security) enabled; branch protection on `main` requiring CI
- [ ] Super admin list reviewed; users from the previous סבב deactivated
