-- ════════════════════════════════════════════════════════════════════════════
-- Security layer: privileges, helper functions, Row-Level Security policies,
-- audit + updated_at triggers. Mirrors packages/auth/src/index.ts.
--
-- Rules every later migration must follow (see docs/SECURITY.md):
--   • every new table: RLS enabled + explicit policies + explicit GRANTs
--   • every new table: the app.audit and app.touch_updated_at triggers
--   • nothing is granted to `anon`
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists app;
--> statement-breakpoint
revoke all on schema app from public;
--> statement-breakpoint
grant usage on schema app to authenticated;
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────
-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- We revoke that (TRUNCATE in particular is not covered by RLS) and grant
-- only what each table needs. New tables start with no access at all.
revoke all on all tables in schema public from anon, authenticated;
--> statement-breakpoint
revoke all on all sequences in schema public from anon, authenticated;
--> statement-breakpoint
revoke all on all functions in schema public from anon;
--> statement-breakpoint
alter default privileges in schema public revoke all on tables from anon, authenticated;
--> statement-breakpoint
alter default privileges in schema public revoke all on sequences from anon, authenticated;
--> statement-breakpoint
alter default privileges in schema public revoke execute on functions from anon;
--> statement-breakpoint

grant select, insert, update, delete on public.units, public.people, public.memberships to authenticated;
--> statement-breakpoint
-- app_users: auth_user_id / last_login_at are only ever set by app.link_auth_user()
grant select, insert, delete on public.app_users to authenticated;
--> statement-breakpoint
grant update (email, display_name, person_id, is_super_admin, active) on public.app_users to authenticated;
--> statement-breakpoint
-- audit_log is written only by triggers
grant select on public.audit_log to authenticated;
--> statement-breakpoint

-- ── Helper functions ────────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read app_users/memberships without recursing
-- into those tables' own policies. search_path = '' prevents hijacking.

create or replace function app.current_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.app_users u
  where u.auth_user_id = auth.uid() and u.active
$$;
--> statement-breakpoint

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.is_super_admin from public.app_users u where u.auth_user_id = auth.uid() and u.active),
    false)
$$;
--> statement-breakpoint

-- The unit itself and all its ancestors (root last).
create or replace function app.unit_lineage(p_unit uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive up(id, parent_id, depth) as (
    select u.id, u.parent_id, 0 from public.units u where u.id = p_unit
    union all
    select u.id, u.parent_id, up.depth + 1
    from public.units u join up on u.id = up.parent_id
    where up.depth < 16
  )
  select id from up
$$;
--> statement-breakpoint

-- Does the current user hold one of p_roles in p_module, covering p_unit?
--   p_roles null → any role.  p_unit null → battalion-level resource
--   (only battalion-wide memberships count). Super admins always pass.
create or replace function app.has_role(
  p_module public.module_id,
  p_roles text[] default null,
  p_unit uuid default null
) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1
    from public.memberships m
    join public.app_users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()
      and u.active
      and m.module = p_module
      and (p_roles is null or m.role = any (p_roles))
      and (m.unit_id is null or m.unit_id in (select app.unit_lineage(p_unit)))
  )
$$;
--> statement-breakpoint

-- Module-level check: any membership in the module, on any unit.
create or replace function app.has_module(p_module public.module_id, p_roles text[] default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1
    from public.memberships m
    join public.app_users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()
      and u.active
      and m.module = p_module
      and (p_roles is null or m.role = any (p_roles))
  )
$$;
--> statement-breakpoint

-- Can the current user see data about this unit through ANY module membership?
create or replace function app.sees_unit(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1
    from public.memberships m
    join public.app_users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()
      and u.active
      and (m.unit_id is null or m.unit_id in (select app.unit_lineage(p_unit)))
  )
$$;
--> statement-breakpoint

-- Called once after Google sign-in: links the Google account to the invited
-- app_users row with the same email. Returns the app user id, or null when the
-- email was not invited (→ "no access" screen).
create or replace function app.link_auth_user() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claims   jsonb := auth.jwt();
  v_email    text  := lower(v_claims ->> 'email');
  v_provider text  := v_claims -> 'app_metadata' ->> 'provider';
  v_verified boolean := coalesce((v_claims -> 'user_metadata' ->> 'email_verified')::boolean, false);
  v_id uuid;
begin
  if auth.uid() is null or v_email is null then
    return null;
  end if;
  -- Only Google accounts with a verified email may claim an invite.
  if v_provider is distinct from 'google' or not v_verified then
    return null;
  end if;

  update public.app_users
     set auth_user_id = auth.uid(), last_login_at = now()
   where email = v_email
     and active
     and (auth_user_id is null or auth_user_id = auth.uid())
  returning id into v_id;

  return v_id;
end
$$;
--> statement-breakpoint

revoke all on all functions in schema app from public;
--> statement-breakpoint
grant execute on all functions in schema app to authenticated;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
--> statement-breakpoint

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor_user_id, table_name, row_id, action, before, after)
  values (
    app.current_user_id(),
    tg_table_name,
    v_row ->> 'id',
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end
$$;
--> statement-breakpoint

-- Changing an invite's email detaches the previously linked Google account.
create or replace function app.app_users_email_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := lower(new.email);
  if new.email is distinct from old.email then
    new.auth_user_id := null;
  end if;
  return new;
end
$$;
--> statement-breakpoint

create trigger units_touch before update on public.units for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger people_touch before update on public.people for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger app_users_touch before update on public.app_users for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger memberships_touch before update on public.memberships for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger app_users_email before update of email on public.app_users for each row execute function app.app_users_email_changed();
--> statement-breakpoint

create trigger units_audit after insert or update or delete on public.units for each row execute function app.audit();
--> statement-breakpoint
create trigger people_audit after insert or update or delete on public.people for each row execute function app.audit();
--> statement-breakpoint
create trigger app_users_audit after insert or update or delete on public.app_users for each row execute function app.audit();
--> statement-breakpoint
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

-- units: every active user can read the structure; only battalion core admins change it.
create policy units_select on public.units for select to authenticated
  using ((select app.current_user_id()) is not null);
--> statement-breakpoint
create policy units_insert on public.units for insert to authenticated
  with check ((select app.has_role('core', array['admin'])));
--> statement-breakpoint
create policy units_update on public.units for update to authenticated
  using ((select app.has_role('core', array['admin'])))
  with check ((select app.has_role('core', array['admin'])));
--> statement-breakpoint
create policy units_delete on public.units for delete to authenticated
  using ((select app.has_role('core', array['admin'])));
--> statement-breakpoint

-- people: visible where the user has any membership covering the unit;
-- editable by core admin/editor on that unit.
create policy people_select on public.people for select to authenticated
  using (app.sees_unit(unit_id));
--> statement-breakpoint
create policy people_insert on public.people for insert to authenticated
  with check (app.has_role('core', array['admin', 'editor'], unit_id));
--> statement-breakpoint
create policy people_update on public.people for update to authenticated
  using (app.has_role('core', array['admin', 'editor'], unit_id))
  with check (app.has_role('core', array['admin', 'editor'], unit_id));
--> statement-breakpoint
create policy people_delete on public.people for delete to authenticated
  using (app.has_role('core', array['admin'], unit_id));
--> statement-breakpoint

-- app_users: you see yourself; battalion core admins see and manage everyone
-- except super admins, and only a super admin can create/modify a super admin.
create policy app_users_select on public.app_users for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select app.has_role('core', array['admin'])));
--> statement-breakpoint
create policy app_users_insert on public.app_users for insert to authenticated
  with check (
    (select app.has_role('core', array['admin']))
    and (not is_super_admin or (select app.is_super_admin()))
  );
--> statement-breakpoint
create policy app_users_update on public.app_users for update to authenticated
  using ((select app.is_super_admin()) or ((select app.has_role('core', array['admin'])) and not is_super_admin))
  with check ((select app.is_super_admin()) or ((select app.has_role('core', array['admin'])) and not is_super_admin));
--> statement-breakpoint
create policy app_users_delete on public.app_users for delete to authenticated
  using ((select app.is_super_admin()) or ((select app.has_role('core', array['admin'])) and not is_super_admin));
--> statement-breakpoint

-- memberships: you see your own; battalion core admins manage all.
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select app.current_user_id()) or (select app.has_role('core', array['admin'])));
--> statement-breakpoint
create policy memberships_insert on public.memberships for insert to authenticated
  with check ((select app.has_role('core', array['admin'])));
--> statement-breakpoint
create policy memberships_update on public.memberships for update to authenticated
  using ((select app.has_role('core', array['admin'])))
  with check ((select app.has_role('core', array['admin'])));
--> statement-breakpoint
create policy memberships_delete on public.memberships for delete to authenticated
  using ((select app.has_role('core', array['admin'])));
--> statement-breakpoint

-- audit_log: battalion core admins read; nobody writes directly.
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select app.has_role('core', array['admin'])));
