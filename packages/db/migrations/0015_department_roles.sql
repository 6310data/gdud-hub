-- ════════════════════════════════════════════════════════════════════════════
-- Department roles: master admin / admin / company user (logistics + doch1).
--
--   master_admin  everything an admin may do, plus the department's settings and
--                 managing the department's own roles (memberships of that module)
--   admin         day-to-day work across the department
--   company_user  their own company (logistics: view and print, no החתמה / זיכוי)
--
-- master_admin counts wherever a check asks for 'admin', so no module policy changes:
-- has_role / has_module / unit_scope accept it. Same rule in can() (packages/auth).
-- ════════════════════════════════════════════════════════════════════════════

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
      and (p_roles is null or m.role = any (p_roles) or (m.role = 'master_admin' and 'admin' = any (p_roles)))
      and (m.unit_id is null or m.unit_id in (select app.unit_lineage(p_unit)))
  )
$$;
--> statement-breakpoint

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
      and (p_roles is null or m.role = any (p_roles) or (m.role = 'master_admin' and 'admin' = any (p_roles)))
  )
$$;
--> statement-breakpoint

create or replace function app.unit_scope(p_module public.module_id default null, p_roles text[] default null)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  with recursive mine as (
    select m.unit_id
    from public.memberships m
    join public.app_users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()
      and u.active
      and (p_module is null or m.module = p_module)
      and (p_roles is null or m.role = any (p_roles) or (m.role = 'master_admin' and 'admin' = any (p_roles)))
  ),
  down(id, depth) as (
    select u.id, 0 from public.units u where u.id in (select unit_id from mine)
    union all
    select u.id, down.depth + 1
    from public.units u join down on u.parent_id = down.id
    where down.depth < 16
  )
  select case
    when app.is_super_admin() or exists (select 1 from mine where unit_id is null) then null
    else coalesce((select array_agg(distinct id) from down), '{}')
  end
$$;
--> statement-breakpoint

-- Master admin of any department: may look up invited users to give them a role.
create or replace function app.is_master_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1
    from public.memberships m
    join public.app_users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()
      and u.active
      and m.role = 'master_admin'
  )
$$;
--> statement-breakpoint
revoke all on function app.is_master_admin() from public;
--> statement-breakpoint
grant execute on function app.is_master_admin() to authenticated;
--> statement-breakpoint

-- logistics "viewer" is now the company user (view + print forms, scoped by its unit).
update public.memberships set role = 'company_user' where module = 'logistics' and role = 'viewer';
--> statement-breakpoint

-- ── app_users: master admins see the invited users (not insert / update / delete) ──

alter policy app_users_select on public.app_users
  using (
    auth_user_id = (select auth.uid())
    or (select app.has_role('core', array['admin']))
    or (select app.is_master_admin())
  );
--> statement-breakpoint

-- ── memberships: a master admin manages the roles of their own department, ──
-- on units they cover (battalion-wide roles only from a battalion-wide master admin).

alter policy memberships_select on public.memberships
  using (
    user_id = (select app.current_user_id())
    or (select app.has_role('core', array['admin']))
    or app.has_role(module, array['master_admin'], unit_id)
  );
--> statement-breakpoint
alter policy memberships_insert on public.memberships
  with check (
    (select app.has_role('core', array['admin']))
    or app.has_role(module, array['master_admin'], unit_id)
  );
--> statement-breakpoint
alter policy memberships_update on public.memberships
  using (
    (select app.has_role('core', array['admin']))
    or app.has_role(module, array['master_admin'], unit_id)
  )
  with check (
    (select app.has_role('core', array['admin']))
    or app.has_role(module, array['master_admin'], unit_id)
  );
--> statement-breakpoint
alter policy memberships_delete on public.memberships
  using (
    (select app.has_role('core', array['admin']))
    or app.has_role(module, array['master_admin'], unit_id)
  );
