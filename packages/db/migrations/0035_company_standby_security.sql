-- ════════════════════════════════════════════════════════════════════════════
-- Each company owns its כוננות / שבצ״ק (spec "Changes requested 2026-10-28", item 4): the same
-- doch1_standby_teams and doch1_vehicles rows, now with unit_id (null = battalion). No sync — the
-- דוח 1 standby page and ניהול פלוגה show the same rows.
-- Tested in packages/db/test/rls.test.ts ("company" → "standby").
--
--   a company team (unit_id set)   its only holder is that company (kept by trigger); its members are
--                                  soldiers of that company; its vehicle is one of the company's.
--                                  Edited by a דוח 1 admin, a דוח 1 company user of that company, or
--                                  that company's admin in ניהול פלוגה.
--   a battalion team (null)        as before: the דוח 1 admin and the company users of its holders.
--   a vehicle's company            set by a דוח 1 admin; a vehicle a company adds is that company's.
--                                  A company sees only its own vehicles in its app.
--   moving a team between battalion and a company → a דוח 1 admin only.
--
-- A company admin without a דוח 1 role reads what the standby needs for their company: the round,
-- its statuses, settings, and their soldiers' round rows and days (read only — filling דוח 1 stays
-- with the דוח 1 roles, call 33).
--
-- Error codes (apps/web/src/lib/action-result.ts):
--   GD005 a company team's soldier / vehicle / holder from another company
--   GD006 only a דוח 1 admin moves a team or a vehicle between companies
-- ════════════════════════════════════════════════════════════════════════════

-- ── Existing data: a team whose members are all of one company, and that no other company holds,
--    becomes that company's ──

update public.doch1_standby_teams t
   set unit_id = x.company
  from (
    select m.team_id, min(app.company_of(p.unit_id)::text)::uuid as company
    from public.doch1_standby_members m
    join public.people p on p.id = m.person_id
    group by m.team_id
    having count(distinct app.company_of(p.unit_id)) = 1 and bool_and(app.company_of(p.unit_id) is not null)
  ) x
 where x.team_id = t.id
   -- a team another company also holds stays shared (battalion)
   and not exists (select 1 from public.doch1_standby_holders h where h.team_id = t.id and h.unit_id <> x.company);
--> statement-breakpoint
-- a vehicle used only by one company's teams moves with them
update public.doch1_vehicles v
   set unit_id = x.unit_id
  from (
    select t.vehicle_id, min(t.unit_id::text)::uuid as unit_id
    from public.doch1_standby_teams t
    where t.vehicle_id is not null
    group by t.vehicle_id
    having count(distinct t.unit_id) = 1 and bool_and(t.unit_id is not null)
  ) x
 where x.vehicle_id = v.id;
--> statement-breakpoint
-- a team whose vehicle couldn't move (it's shared) stays battalion
update public.doch1_standby_teams t
   set unit_id = null
 where t.unit_id is not null and t.vehicle_id is not null
   and (select v.unit_id from public.doch1_vehicles v where v.id = t.vehicle_id) is distinct from t.unit_id;
--> statement-breakpoint
delete from public.doch1_standby_holders h
 using public.doch1_standby_teams t
 where t.id = h.team_id and t.unit_id is not null and h.unit_id <> t.unit_id;
--> statement-breakpoint
insert into public.doch1_standby_holders (team_id, unit_id)
select t.id, t.unit_id from public.doch1_standby_teams t where t.unit_id is not null
on conflict do nothing;
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant update (unit_id) on public.doch1_standby_teams, public.doch1_vehicles to authenticated;
--> statement-breakpoint

-- ── Helper functions ────────────────────────────────────────────────────────

-- May the current user edit a company's own standby (its teams and vehicles)?
create or replace function app.doch1_company_editor(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_unit is not null and (
    app.has_role('doch1', array['admin', 'company_user'], p_unit)
    or app.has_role('company', array['admin'], p_unit)
  )
$$;
--> statement-breakpoint

-- Adds: a company team is also edited by its company's admin in ניהול פלוגה.
create or replace function app.doch1_team_editable(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    app.has_role('doch1', array['admin'])
    or exists (
      select 1 from public.doch1_standby_holders h
      where h.team_id = p_team and app.has_role('doch1', array['company_user'], h.unit_id)
    )
    or exists (
      select 1 from public.doch1_standby_teams t
      where t.id = p_team and t.unit_id is not null and app.has_role('company', array['admin'], t.unit_id)
    ),
    false)
$$;
--> statement-breakpoint

-- Adds: a company's vehicle is edited by its company's editors.
create or replace function app.doch1_vehicle_editable(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    app.has_role('doch1', array['admin'])
    or exists (
      select 1 from public.doch1_standby_teams t
      where t.vehicle_id = p_vehicle and app.doch1_team_editable(t.id)
    )
    or exists (
      select 1 from public.doch1_vehicles v
      where v.id = p_vehicle and app.doch1_company_editor(v.unit_id)
    ),
    false)
$$;
--> statement-breakpoint

-- ── Guard triggers ──────────────────────────────────────────────────────────

-- A team's company: a company unit; its vehicle the company's; only a דוח 1 admin moves it between
-- battalion and a company (and then every member must already be of that company).
create or replace function app.doch1_team_company_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_id is not null and (select u.kind from public.units u where u.id = new.unit_id) is distinct from 'company' then
    raise exception 'a team belongs to a company' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.unit_id is distinct from old.unit_id then
    -- a system job (no user) may move one
    if auth.uid() is not null and not app.has_role('doch1', array['admin']) then
      raise exception 'only a doch1 admin moves a team' using errcode = 'GD006';
    end if;
    if new.unit_id is not null and exists (
      select 1 from public.doch1_standby_members m join public.people p on p.id = m.person_id
      where m.team_id = new.id and app.company_of(p.unit_id) is distinct from new.unit_id
    ) then
      raise exception 'a member is of another company' using errcode = 'GD005';
    end if;
  end if;
  if new.unit_id is not null and new.vehicle_id is not null
    and (select v.unit_id from public.doch1_vehicles v where v.id = new.vehicle_id) is distinct from new.unit_id then
    raise exception 'the vehicle is of another company' using errcode = 'GD005';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_standby_teams_company_guard before insert or update of unit_id, vehicle_id on public.doch1_standby_teams
  for each row execute function app.doch1_team_company_guard();
--> statement-breakpoint

-- A company team's holder is its company, and only it.
create or replace function app.doch1_team_company_holders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_id is not null then
    delete from public.doch1_standby_holders h where h.team_id = new.id and h.unit_id <> new.unit_id;
    insert into public.doch1_standby_holders (team_id, unit_id) values (new.id, new.unit_id) on conflict do nothing;
  end if;
  return null;
end
$$;
--> statement-breakpoint
create trigger doch1_standby_teams_company_holders after insert or update of unit_id on public.doch1_standby_teams
  for each row execute function app.doch1_team_company_holders();
--> statement-breakpoint

create or replace function app.doch1_holder_company_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_unit uuid := (select t.unit_id from public.doch1_standby_teams t where t.id = new.team_id);
begin
  if v_unit is not null and new.unit_id <> v_unit then
    raise exception 'a company team is held by its company only' using errcode = 'GD005';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_standby_holders_company_guard before insert on public.doch1_standby_holders
  for each row execute function app.doch1_holder_company_guard();
--> statement-breakpoint

create or replace function app.doch1_team_member_company_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_unit uuid := (select t.unit_id from public.doch1_standby_teams t where t.id = new.team_id);
begin
  if v_unit is not null
    and app.company_of((select p.unit_id from public.people p where p.id = new.person_id)) is distinct from v_unit then
    raise exception 'a company team takes the company''s soldiers only' using errcode = 'GD005';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_standby_members_company_guard before insert or update of team_id, person_id on public.doch1_standby_members
  for each row execute function app.doch1_team_member_company_guard();
--> statement-breakpoint

-- A vehicle's company: a company unit; set by a דוח 1 admin, or by a company adding its own vehicle;
-- never away from a company whose team uses it.
create or replace function app.doch1_vehicle_company_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_id is not null and (select u.kind from public.units u where u.id = new.unit_id) is distinct from 'company' then
    raise exception 'a vehicle belongs to a company' using errcode = '23514';
  end if;
  -- who may add one is the insert policy's; a system job (no user) may move one
  if tg_op = 'UPDATE' and new.unit_id is distinct from old.unit_id then
    if auth.uid() is not null and not app.has_role('doch1', array['admin']) then
      raise exception 'only a doch1 admin moves a vehicle' using errcode = 'GD006';
    end if;
    if exists (
      select 1 from public.doch1_standby_teams t
      where t.vehicle_id = new.id and t.unit_id is not null and t.unit_id is distinct from new.unit_id
    ) then
      raise exception 'a team of another company uses the vehicle' using errcode = 'GD005';
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_vehicles_company_guard before insert or update of unit_id on public.doch1_vehicles
  for each row execute function app.doch1_vehicle_company_guard();
--> statement-breakpoint

revoke all on function app.doch1_company_editor(uuid), app.doch1_team_company_guard(), app.doch1_team_company_holders(),
  app.doch1_holder_company_guard(), app.doch1_team_member_company_guard(), app.doch1_vehicle_company_guard() from public;
--> statement-breakpoint
grant execute on function app.doch1_company_editor(uuid) to authenticated;
--> statement-breakpoint

-- ── Policies: a company admin reads their company's standby and דוח 1 rows ──

alter policy doch1_rounds_select on public.doch1_rounds
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_round_companies_select on public.doch1_round_companies
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_statuses_select on public.doch1_statuses
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_field_options_select on public.doch1_field_options
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_locations_select on public.doch1_locations
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_standby_types_select on public.doch1_standby_types
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_members_select on public.doch1_members
  using (person_id in (select app.people_in_scope('doch1')) or person_id in (select app.people_in_scope('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_days_select on public.doch1_days
  using (person_id in (select app.people_in_scope('doch1')) or person_id in (select app.people_in_scope('company', array['admin'])));
--> statement-breakpoint
alter policy doch1_standby_teams_select on public.doch1_standby_teams
  using (
    (select app.has_module('doch1'))
    or (unit_id is not null and ((select app.unit_scope('company', array['admin'])) is null or unit_id = any ((select app.unit_scope('company', array['admin']))::uuid[])))
  );
--> statement-breakpoint
alter policy doch1_standby_holders_select on public.doch1_standby_holders
  using ((select app.has_module('doch1')) or team_id in (select t.id from public.doch1_standby_teams t));
--> statement-breakpoint
alter policy doch1_vehicles_select on public.doch1_vehicles
  using (
    (select app.has_module('doch1'))
    or (unit_id is not null and ((select app.unit_scope('company', array['admin'])) is null or unit_id = any ((select app.unit_scope('company', array['admin']))::uuid[])))
  );
--> statement-breakpoint

-- ── Policies: writing a company's standby ──────────────────────────────────

alter policy doch1_standby_teams_insert on public.doch1_standby_teams
  with check (
    (select app.has_role('doch1', array['admin']))
    or (unit_id is null and (select app.has_module('doch1', array['company_user'])))
    or app.doch1_company_editor(unit_id)
  );
--> statement-breakpoint
alter policy doch1_standby_members_insert on public.doch1_standby_members
  with check (
    app.doch1_team_editable(team_id)
    and (
      person_id in (select app.people_in_scope('doch1', array['admin', 'company_user']))
      or person_id in (select app.people_in_scope('company', array['admin']))
    )
  );
--> statement-breakpoint
-- a battalion vehicle (no company): the admin or any company user, as before; a company's: its editors
alter policy doch1_vehicles_insert on public.doch1_vehicles
  with check (
    (select app.has_role('doch1', array['admin']))
    or (unit_id is null and (select app.has_module('doch1', array['company_user'])))
    or app.doch1_company_editor(unit_id)
  );
