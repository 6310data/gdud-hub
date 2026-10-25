-- ════════════════════════════════════════════════════════════════════════════
-- דוח 1 שבצ״ק and standby: privileges, helpers, the round guard, RLS policies, triggers.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("doch1 standby").
--
-- Who can do what:
--   locations, standby types           → battalion-wide doch1 admin (everyone in doch1 reads)
--   soldier's location (members)       → admin / company_user covering the soldier (0005's members policy)
--   teams: read                        → everyone in doch1
--          create                      → admin, or a company user (who then adds their company as holder)
--          edit / delete               → admin, or a company user of one of the team's holding companies
--   holders: add                       → admin; a company user only their own company, and only to a team
--                                         with no holder yet (their new team) — never to someone else's team
--            remove                    → admin, or a company user of that company
--   team members: read                 → any doch1 role covering the soldier, or an editor of the team
--                 add                  → an editor of the team, for a soldier they cover as admin / company user
--                 edit role / remove   → an editor of the team
--   vehicles: read                     → everyone in doch1
--             add                      → admin or any company user (typing a new צ׳ in the team editor)
--             edit                     → admin, or an editor of a team that uses the vehicle
--             delete                   → admin
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper functions ────────────────────────────────────────────────────────

-- May the current user edit this team? Battalion admin, or a company user of a holding company.
create or replace function app.doch1_team_editable(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    app.has_role('doch1', array['admin'])
    or exists (
      select 1 from public.doch1_standby_holders h
      where h.team_id = p_team and app.has_role('doch1', array['company_user'], h.unit_id)
    ),
    false)
$$;
--> statement-breakpoint

create or replace function app.doch1_team_has_holders(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.doch1_standby_holders h where h.team_id = p_team)
$$;
--> statement-breakpoint

-- May the current user edit this vehicle? Battalion admin, or an editor of a team that uses it.
create or replace function app.doch1_vehicle_editable(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    app.has_role('doch1', array['admin'])
    or exists (
      select 1 from public.doch1_standby_teams t
      where t.vehicle_id = p_vehicle and app.doch1_team_editable(t.id)
    ),
    false)
$$;
--> statement-breakpoint

revoke all on function app.doch1_team_editable(uuid), app.doch1_team_has_holders(uuid), app.doch1_vehicle_editable(uuid) from public;
--> statement-breakpoint
grant execute on function app.doch1_team_editable(uuid), app.doch1_team_has_holders(uuid), app.doch1_vehicle_editable(uuid) to authenticated;
--> statement-breakpoint

-- ── The round guard ─────────────────────────────────────────────────────────
-- A team's type and location, and a soldier's location, belong to the same round.
-- Not SECURITY DEFINER; the lookups read settings tables everyone in doch1 may read.
create or replace function app.doch1_standby_team_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type_id is not null
     and (select t.round_id from public.doch1_standby_types t where t.id = new.type_id) is distinct from new.round_id then
    raise exception 'standby type belongs to another round' using errcode = '23514';
  end if;
  if new.location_id is not null
     and (select l.round_id from public.doch1_locations l where l.id = new.location_id) is distinct from new.round_id then
    raise exception 'location belongs to another round' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_standby_teams_guard before insert or update on public.doch1_standby_teams for each row execute function app.doch1_standby_team_guard();
--> statement-breakpoint

create or replace function app.doch1_member_location_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.location_id is not null
     and (select l.round_id from public.doch1_locations l where l.id = new.location_id) is distinct from new.round_id then
    raise exception 'location belongs to another round' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_members_location_guard before insert or update of location_id on public.doch1_members for each row execute function app.doch1_member_location_guard();
--> statement-breakpoint
revoke all on function app.doch1_standby_team_guard(), app.doch1_member_location_guard() from public;
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.doch1_locations, public.doch1_standby_types to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_standby_teams to authenticated;
--> statement-breakpoint
grant update (type_id, name, location_id, vehicle_id, active, sort_order, updated_at) on public.doch1_standby_teams to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_standby_holders to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_standby_members to authenticated;
--> statement-breakpoint
grant update (role, sort_order, updated_at) on public.doch1_standby_members to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_vehicles to authenticated;
--> statement-breakpoint
grant update (number, kind, state, notes, active, updated_at) on public.doch1_vehicles to authenticated;
--> statement-breakpoint
grant update (location_id) on public.doch1_members to authenticated;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger doch1_locations_touch before update on public.doch1_locations for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_vehicles_touch before update on public.doch1_vehicles for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_standby_types_touch before update on public.doch1_standby_types for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_standby_teams_touch before update on public.doch1_standby_teams for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_standby_members_touch before update on public.doch1_standby_members for each row execute function app.touch_updated_at();
--> statement-breakpoint

create trigger doch1_locations_audit after insert or update or delete on public.doch1_locations for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_vehicles_audit after insert or update or delete on public.doch1_vehicles for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_standby_types_audit after insert or update or delete on public.doch1_standby_types for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_standby_teams_audit after insert or update or delete on public.doch1_standby_teams for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_standby_holders_audit after insert or update or delete on public.doch1_standby_holders for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_standby_members_audit after insert or update or delete on public.doch1_standby_members for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies: settings (locations, standby types) ──────────────────────────

create policy doch1_locations_select on public.doch1_locations for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_locations_insert on public.doch1_locations for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_locations_update on public.doch1_locations for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_locations_delete on public.doch1_locations for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_standby_types_select on public.doch1_standby_types for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_standby_types_insert on public.doch1_standby_types for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_standby_types_update on public.doch1_standby_types for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_standby_types_delete on public.doch1_standby_types for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

-- ── Policies: teams and holders ─────────────────────────────────────────────

create policy doch1_standby_teams_select on public.doch1_standby_teams for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_standby_teams_insert on public.doch1_standby_teams for insert to authenticated
  with check ((select app.has_role('doch1', array['admin']) or app.has_module('doch1', array['company_user'])));
--> statement-breakpoint
create policy doch1_standby_teams_update on public.doch1_standby_teams for update to authenticated
  using (app.doch1_team_editable(id))
  with check (app.doch1_team_editable(id));
--> statement-breakpoint
create policy doch1_standby_teams_delete on public.doch1_standby_teams for delete to authenticated
  using (app.doch1_team_editable(id));
--> statement-breakpoint

create policy doch1_standby_holders_select on public.doch1_standby_holders for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_standby_holders_insert on public.doch1_standby_holders for insert to authenticated
  with check (
    app.has_role('doch1', array['admin'])
    or (app.has_role('doch1', array['company_user'], unit_id) and not app.doch1_team_has_holders(team_id))
  );
--> statement-breakpoint
create policy doch1_standby_holders_delete on public.doch1_standby_holders for delete to authenticated
  using (app.has_role('doch1', array['admin', 'company_user'], unit_id));
--> statement-breakpoint

-- ── Policies: team members ──────────────────────────────────────────────────

create policy doch1_standby_members_select on public.doch1_standby_members for select to authenticated
  using (app.has_role('doch1', null, app.doch1_person_unit(person_id)) or app.doch1_team_editable(team_id));
--> statement-breakpoint
create policy doch1_standby_members_insert on public.doch1_standby_members for insert to authenticated
  with check (
    app.doch1_team_editable(team_id)
    and app.has_role('doch1', array['admin', 'company_user'], app.doch1_person_unit(person_id))
  );
--> statement-breakpoint
create policy doch1_standby_members_update on public.doch1_standby_members for update to authenticated
  using (app.doch1_team_editable(team_id))
  with check (app.doch1_team_editable(team_id));
--> statement-breakpoint
create policy doch1_standby_members_delete on public.doch1_standby_members for delete to authenticated
  using (app.doch1_team_editable(team_id));
--> statement-breakpoint

-- ── Policies: vehicles ──────────────────────────────────────────────────────

create policy doch1_vehicles_select on public.doch1_vehicles for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_vehicles_insert on public.doch1_vehicles for insert to authenticated
  with check ((select app.has_role('doch1', array['admin']) or app.has_module('doch1', array['company_user'])));
--> statement-breakpoint
create policy doch1_vehicles_update on public.doch1_vehicles for update to authenticated
  using (app.doch1_vehicle_editable(id))
  with check (app.doch1_vehicle_editable(id));
--> statement-breakpoint
create policy doch1_vehicles_delete on public.doch1_vehicles for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
