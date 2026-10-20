/**
 * Minimal stand-in for the parts of Supabase that our migrations rely on,
 * so RLS can be tested in-process with PGlite (no Docker, no network).
 */
export const SUPABASE_SHIM_SQL = /* sql */ `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;

  grant usage on schema public to anon, authenticated;
  -- Supabase's default: new public tables are fully granted to anon/authenticated.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;
