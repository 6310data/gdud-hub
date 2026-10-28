-- ════════════════════════════════════════════════════════════════════════════
-- ניהול פלוגה: פעילות (spec "Changes requested 2026-10-28", item 5).
-- Tested in packages/db/test/rls.test.ts ("company" → "activities").
--
--   activities            read: members of the company, and a soldier taking part
--                         write: the company admin and the company's platoon commanders
--   participants          read: members of the company, and the soldier themselves
--                         add / remove: the company admin (anyone in the company) or a platoon
--                         commander (their platoon's soldiers, call 36) — only a soldier whose דוח 1
--                         status that day is present and not home (the planned status for a future
--                         day; no status = not offered). A later change is flagged, not removed.
--   vehicles              the company's own (doch1_vehicles.unit_id); written by the commanders
-- Nothing here writes דוח 1.
--
-- Error codes (apps/web/src/lib/company/errors.ts):
--   GD118 the soldier isn't present (or is home) that day in דוח 1
--   GD119 the soldier / vehicle / commander isn't of this company
-- ════════════════════════════════════════════════════════════════════════════

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, delete on public.company_activities to authenticated;
--> statement-breakpoint
-- the company of an activity never changes
grant update (name, day, starts_at, ends_at, place, commander_person_id, notes) on public.company_activities to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.company_activity_participants to authenticated;
--> statement-breakpoint
grant update (role) on public.company_activity_participants to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.company_activity_vehicles to authenticated;
--> statement-breakpoint

-- ── Helper functions ────────────────────────────────────────────────────────

-- The company admin, or a platoon commander of one of the company's platoons.
create or replace function app.company_commander(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_unit is not null and (
    app.has_role('company', array['admin'], p_unit)
    or exists (
      select 1 from public.memberships m join public.app_users u on u.id = m.user_id
      where u.auth_user_id = auth.uid() and u.active and m.module = 'company' and m.role = 'platoon_commander'
        and m.unit_id in (select app.unit_subtree(p_unit))
    )
  )
$$;
--> statement-breakpoint

-- May the current user put this soldier on (or take them off) an activity of p_unit? Admin: anyone of
-- the company; platoon commander: their platoon's. (Adding also needs an active soldier: the guard.)
create or replace function app.company_can_place(p_unit uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people p
    where p.id = p_person and app.company_of(p.unit_id) = p_unit
      and (app.has_role('company', array['admin'], p_unit) or app.has_role('company', array['platoon_commander'], p.unit_id))
  )
$$;
--> statement-breakpoint

-- Present and not home in דוח 1 that day (the status of the day, planned or reported).
create or replace function app.company_present_on(p_person uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.doch1_days d join public.doch1_statuses st on st.id = d.status_id
    where d.person_id = p_person and d.day = p_day and st.counts_as_present and not st.home_day
  )
$$;
--> statement-breakpoint

create or replace function app.company_activity_unit(p_activity uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.unit_id from public.company_activities a where a.id = p_activity
$$;
--> statement-breakpoint

create or replace function app.company_in_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_activity_participants x
    where x.activity_id = p_activity and x.person_id = app.my_person_id()
  )
$$;
--> statement-breakpoint

-- ── Reads (names across platoons without people rows; דוח 1 status without דוח 1 access) ──

-- Soldiers of the company the caller may add to the activity, who are present and not home that day.
create or replace function app.company_activity_candidates(p_activity uuid)
returns table (id uuid, full_name text, unit_id uuid, status_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_a public.company_activities;
begin
  select * into v_a from public.company_activities a where a.id = p_activity;
  if v_a.id is null or not app.company_commander(v_a.unit_id) then
    return;
  end if;
  return query
    select p.id, p.full_name, p.unit_id, st.name
    from public.people p
    join public.doch1_days d on d.person_id = p.id and d.day = v_a.day
    join public.doch1_statuses st on st.id = d.status_id
    where p.active and p.unit_id in (select app.unit_subtree(v_a.unit_id))
      and st.counts_as_present and not st.home_day
      and app.company_can_place(v_a.unit_id, p.id)
      and not exists (select 1 from public.company_activity_participants x where x.activity_id = v_a.id and x.person_id = p.id);
end
$$;
--> statement-breakpoint

-- Who goes, with their דוח 1 status that day and whether it still qualifies, for a member of the company.
create or replace function app.company_activity_people(p_activity uuid)
returns table (participant_id uuid, person_id uuid, full_name text, unit_id uuid, role text, status_name text, qualifies boolean, can_remove boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_a public.company_activities;
begin
  select * into v_a from public.company_activities a where a.id = p_activity;
  if v_a.id is null or not app.company_member(v_a.unit_id) then
    return;
  end if;
  return query
    select x.id, p.id, p.full_name, p.unit_id, x.role, st.name,
      coalesce(st.counts_as_present and not st.home_day, false),
      app.company_can_place(v_a.unit_id, p.id)
    from public.company_activity_participants x
    join public.people p on p.id = x.person_id
    left join public.doch1_days d on d.person_id = p.id and d.day = v_a.day
    left join public.doch1_statuses st on st.id = d.status_id
    where x.activity_id = v_a.id;
end
$$;
--> statement-breakpoint

-- A soldier's coming activities (אני), for the soldier or a commander who sees them.
create or replace function app.person_activities(p_person uuid)
returns table (id uuid, name text, day date, starts_at time, ends_at time, place text, role text, commander_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_sees_person(p_person) then
    return;
  end if;
  return query
    select a.id, a.name, a.day, a.starts_at, a.ends_at, a.place, x.role, cp.full_name
    from public.company_activity_participants x
    join public.company_activities a on a.id = x.activity_id
    left join public.people cp on cp.id = a.commander_person_id
    where x.person_id = p_person and a.day >= (now() at time zone 'Asia/Jerusalem')::date
    order by a.day, a.starts_at;
end
$$;
--> statement-breakpoint

-- ── Guard triggers ──────────────────────────────────────────────────────────

create or replace function app.company_activities_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select u.kind from public.units u where u.id = new.unit_id) is distinct from 'company' then
    raise exception 'an activity belongs to a company' using errcode = '23514';
  end if;
  if new.commander_person_id is not null and (tg_op = 'INSERT' or new.commander_person_id is distinct from old.commander_person_id)
    and app.company_of((select p.unit_id from public.people p where p.id = new.commander_person_id)) is distinct from new.unit_id then
    raise exception 'the commander is not of this company' using errcode = 'GD119';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := app.current_user_id();
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger company_activities_guard before insert or update on public.company_activities
  for each row execute function app.company_activities_guard();
--> statement-breakpoint

create or replace function app.company_activity_participants_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.company_activities;
begin
  select * into v_a from public.company_activities a where a.id = new.activity_id;
  if app.company_of((select p.unit_id from public.people p where p.id = new.person_id and p.active)) is distinct from v_a.unit_id then
    raise exception 'the soldier is not of this company' using errcode = 'GD119';
  end if;
  if not app.company_present_on(new.person_id, v_a.day) then
    raise exception 'the soldier is not present that day' using errcode = 'GD118';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger company_activity_participants_guard before insert on public.company_activity_participants
  for each row execute function app.company_activity_participants_guard();
--> statement-breakpoint

create or replace function app.company_activity_vehicles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select v.unit_id from public.doch1_vehicles v where v.id = new.vehicle_id) is distinct from app.company_activity_unit(new.activity_id) then
    raise exception 'the vehicle is not of this company' using errcode = 'GD119';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger company_activity_vehicles_guard before insert on public.company_activity_vehicles
  for each row execute function app.company_activity_vehicles_guard();
--> statement-breakpoint

create trigger company_activities_touch before update on public.company_activities for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger company_activity_participants_touch before update on public.company_activity_participants for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger company_activities_audit after insert or update or delete on public.company_activities for each row execute function app.audit();
--> statement-breakpoint
create trigger company_activity_participants_audit after insert or update or delete on public.company_activity_participants for each row execute function app.audit();
--> statement-breakpoint
create trigger company_activity_vehicles_audit after insert or update or delete on public.company_activity_vehicles for each row execute function app.audit();
--> statement-breakpoint

revoke all on function app.company_commander(uuid), app.company_can_place(uuid, uuid), app.company_present_on(uuid, date),
  app.company_activity_unit(uuid), app.company_in_activity(uuid), app.company_activity_candidates(uuid),
  app.company_activity_people(uuid), app.person_activities(uuid), app.company_activities_guard(),
  app.company_activity_participants_guard(), app.company_activity_vehicles_guard() from public;
--> statement-breakpoint
grant execute on function app.company_commander(uuid), app.company_can_place(uuid, uuid), app.company_present_on(uuid, date),
  app.company_activity_unit(uuid), app.company_in_activity(uuid), app.company_activity_candidates(uuid),
  app.company_activity_people(uuid), app.person_activities(uuid) to authenticated;
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

create policy company_activities_select on public.company_activities for select to authenticated
  using (app.company_member(unit_id) or app.company_in_activity(id));
--> statement-breakpoint
create policy company_activities_insert on public.company_activities for insert to authenticated
  with check (app.company_commander(unit_id));
--> statement-breakpoint
create policy company_activities_update on public.company_activities for update to authenticated
  using (app.company_commander(unit_id))
  with check (app.company_commander(unit_id));
--> statement-breakpoint
create policy company_activities_delete on public.company_activities for delete to authenticated
  using (app.company_commander(unit_id));
--> statement-breakpoint

create policy company_activity_participants_select on public.company_activity_participants for select to authenticated
  using (app.company_member(app.company_activity_unit(activity_id)) or person_id = (select app.my_person_id()));
--> statement-breakpoint
create policy company_activity_participants_insert on public.company_activity_participants for insert to authenticated
  with check (app.company_can_place(app.company_activity_unit(activity_id), person_id));
--> statement-breakpoint
create policy company_activity_participants_update on public.company_activity_participants for update to authenticated
  using (app.company_can_place(app.company_activity_unit(activity_id), person_id))
  with check (app.company_can_place(app.company_activity_unit(activity_id), person_id));
--> statement-breakpoint
create policy company_activity_participants_delete on public.company_activity_participants for delete to authenticated
  using (app.company_can_place(app.company_activity_unit(activity_id), person_id));
--> statement-breakpoint

create policy company_activity_vehicles_select on public.company_activity_vehicles for select to authenticated
  using (app.company_member(app.company_activity_unit(activity_id)));
--> statement-breakpoint
create policy company_activity_vehicles_insert on public.company_activity_vehicles for insert to authenticated
  with check (app.company_commander(app.company_activity_unit(activity_id)));
--> statement-breakpoint
create policy company_activity_vehicles_delete on public.company_activity_vehicles for delete to authenticated
  using (app.company_commander(app.company_activity_unit(activity_id)));
--> statement-breakpoint

-- the company's own vehicles are read by every member of the company (platoon commanders put them on
-- activities); still only the company's, never the battalion's or another company's
alter policy doch1_vehicles_select on public.doch1_vehicles
  using ((select app.has_module('doch1')) or (unit_id is not null and app.company_member(unit_id)));
