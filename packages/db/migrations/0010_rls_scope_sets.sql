-- ════════════════════════════════════════════════════════════════════════════
-- RLS performance: check soldier- and unit-scoped rows against a set computed once
-- per statement, instead of calling has_role() / sees_unit() for every row.
--
-- The per-row form — app.has_role(m, roles, app.person_unit(person_id)) — ran ~5 lookups
-- and a recursive unit walk for each row (~0.75 ms/row: 30k doch1 days took over 20 s).
-- The rules are unchanged: a row is visible / writable exactly when it was before.
--   unit_scope(m, roles)      the units the user covers (null = everything)
--   people_in_scope(m, roles) the soldiers in those units
-- Written as `person_id in (select app.people_in_scope(…))`, Postgres evaluates the set
-- once and probes it with a hash per row.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper functions ────────────────────────────────────────────────────────

-- Units the current user covers with one of p_roles in p_module (p_module null → any module):
-- each membership's unit and everything below it. Null means everything — a super admin, or a
-- battalion-wide membership. Same rule as has_role() / sees_unit(), walked down instead of up.
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
      and (p_roles is null or m.role = any (p_roles))
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

-- Soldiers whose unit the current user covers (see unit_scope). Soldiers without a unit
-- count only when everything is covered, as with has_role(…, null).
create or replace function app.people_in_scope(p_module public.module_id, p_roles text[] default null)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id
  from public.people p, (select app.unit_scope(p_module, p_roles) as s) scope
  where scope.s is null or p.unit_id = any (scope.s)
$$;
--> statement-breakpoint

revoke all on function app.unit_scope(public.module_id, text[]), app.people_in_scope(public.module_id, text[]) from public;
--> statement-breakpoint
grant execute on function app.unit_scope(public.module_id, text[]), app.people_in_scope(public.module_id, text[]) to authenticated;
--> statement-breakpoint

-- ── people (0001) ───────────────────────────────────────────────────────────

alter policy people_select on public.people
  using ((select app.unit_scope()) is null or unit_id = any ((select app.unit_scope())::uuid[]));
--> statement-breakpoint

-- ── logistics (0003) ────────────────────────────────────────────────────────

alter policy logistics_assignments_select on public.logistics_assignments
  using (person_id in (select app.people_in_scope('logistics')));
--> statement-breakpoint
alter policy logistics_assignments_insert on public.logistics_assignments
  with check (
    person_id in (select app.people_in_scope('logistics', array['admin']))
    and signed_by is not distinct from app.current_user_id()
  );
--> statement-breakpoint
alter policy logistics_assignments_update on public.logistics_assignments
  using (person_id in (select app.people_in_scope('logistics', array['admin'])))
  with check (person_id in (select app.people_in_scope('logistics', array['admin'])));
--> statement-breakpoint

alter policy logistics_storage_select on public.logistics_storage
  using (person_id in (select app.people_in_scope('logistics')));
--> statement-breakpoint
alter policy logistics_storage_insert on public.logistics_storage
  with check (person_id in (select app.people_in_scope('logistics', array['admin'])));
--> statement-breakpoint
alter policy logistics_storage_update on public.logistics_storage
  using (person_id in (select app.people_in_scope('logistics', array['admin'])))
  with check (person_id in (select app.people_in_scope('logistics', array['admin'])));
--> statement-breakpoint

alter policy logistics_forms_select on public.logistics_forms
  using (person_id in (select app.people_in_scope('logistics')));
--> statement-breakpoint
alter policy logistics_forms_insert on public.logistics_forms
  with check (
    person_id in (select app.people_in_scope('logistics', array['admin']))
    and created_by is not distinct from app.current_user_id()
  );
--> statement-breakpoint

alter policy logistics_events_select on public.logistics_events
  using (
    (select app.has_module('logistics'))
    and (person_id is null or person_id in (select app.people_in_scope('logistics')))
  );
--> statement-breakpoint
alter policy logistics_events_insert on public.logistics_events
  with check (
    (select app.has_module('logistics', array['admin']))
    and actor_user_id is not distinct from app.current_user_id()
    and case
      -- stock events (no soldier) are visible battalion-wide: battalion admins only
      when person_id is null then (select app.has_role('logistics', array['admin']))
      else person_id in (select app.people_in_scope('logistics', array['admin']))
    end
  );
--> statement-breakpoint

-- ── doch1 (0005) ────────────────────────────────────────────────────────────

alter policy doch1_members_select on public.doch1_members
  using (person_id in (select app.people_in_scope('doch1')));
--> statement-breakpoint
alter policy doch1_members_update on public.doch1_members
  using (person_id in (select app.people_in_scope('doch1', array['admin', 'company_user'])))
  with check (person_id in (select app.people_in_scope('doch1', array['admin', 'company_user'])));
--> statement-breakpoint

alter policy doch1_days_select on public.doch1_days
  using (person_id in (select app.people_in_scope('doch1')));
--> statement-breakpoint
alter policy doch1_days_insert on public.doch1_days
  with check (person_id in (select app.people_in_scope('doch1', array['admin', 'company_user', 'platoon_commander'])));
--> statement-breakpoint
alter policy doch1_days_update on public.doch1_days
  using (person_id in (select app.people_in_scope('doch1', array['admin', 'company_user', 'platoon_commander'])))
  with check (person_id in (select app.people_in_scope('doch1', array['admin', 'company_user', 'platoon_commander'])));
--> statement-breakpoint
alter policy doch1_days_delete on public.doch1_days
  using (person_id in (select app.people_in_scope('doch1', array['admin', 'company_user', 'platoon_commander'])));
--> statement-breakpoint

-- ── doch1 standby (0008) ────────────────────────────────────────────────────

alter policy doch1_standby_members_select on public.doch1_standby_members
  using (person_id in (select app.people_in_scope('doch1')) or app.doch1_team_editable(team_id));
--> statement-breakpoint
alter policy doch1_standby_members_insert on public.doch1_standby_members
  with check (
    app.doch1_team_editable(team_id)
    and person_id in (select app.people_in_scope('doch1', array['admin', 'company_user']))
  );
