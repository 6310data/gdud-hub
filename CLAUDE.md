# gdud-hub — notes for AI assistants

Read README.md, docs/SECURITY.md and docs/ADDING_A_MODULE.md first.

- UI language is Hebrew, RTL. Use the Tzelem design system (`@gdud/ui`, `tz-` classes); don't invent new colors — tokens are in `packages/ui/src/tzelem.css`.
- Serials (צ׳), personal numbers and phones: `<Serial>` / `tz-serial` (mono, LTR).
- Every data access from a request: `withUser(session.claims, tx => …)`. Never `systemDb()` in request code.
- Every page in `(shell)`: `requireModule("<id>")` (or `requireSession()`), then `can()` for finer checks.
- Every new table: RLS + grants + audit trigger + tests in `packages/db/test/rls.test.ts`.
- Next.js 16: `proxy.ts` (not middleware), async `params`/`searchParams`/`cookies()`. Version-matched docs: `apps/web/node_modules/next/dist/docs/`.
- Run `pnpm test && pnpm typecheck && pnpm lint` before calling a change done.
