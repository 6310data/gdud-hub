-- ════════════════════════════════════════════════════════════════════════════
-- דוח 1 module: privileges, helper functions, the day lock guard, RLS policies, triggers.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("doch1").
--
-- Who can do what (roles from packages/core/src/modules.ts):
--   rounds, round companies, statuses, import mappings → battalion-wide doch1 admin (everyone in doch1 reads)
--   members: read                      → any doch1 role covering the soldier's unit
--            edit fields               → admin / company_user covering the soldier
--            add / remove              → battalion-wide admin (the sheet import)
--   days:    read                      → any doch1 role covering the soldier's unit
--            write                     → admin / company_user / platoon_commander covering the soldier,
--                                         AND the day is open (doch1_days_guard):
--                                         future days always; today until the round's lock time
--                                         (Israel clock); past days battalion admin only
--   push subscriptions                 → each user their own
--   reminder requests, brigade log     → battalion admin, in their own name
--   reminder log                       → battalion admin reads; written by the cron job (owner)
--   adding / editing soldiers (people) → also doch1 admin / company_user on that unit
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper functions ────────────────────────────────────────────────────────

-- Unit of a soldier, without going through people's own RLS (used inside policies).
create or replace function app.doch1_person_unit(p_person uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.unit_id from public.people p where p.id = p_person and app.has_module('doch1')
$$;
--> statement-breakpoint

-- May the current user write this day? Same rule as isDayWritable() in
-- packages/core/src/doch1/dates.ts — keep them in sync.
create or replace function app.doch1_day_open(p_round uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    app.has_role('doch1', array['admin'])
    or p_day > (now() at time zone 'Asia/Jerusalem')::date
    or (
      p_day = (now() at time zone 'Asia/Jerusalem')::date
      and (now() at time zone 'Asia/Jerusalem')::time < (select r.lock_at from public.doch1_rounds r where r.id = p_round)
    ),
    false)
$$;
--> statement-breakpoint

create or replace function app.doch1_day_in_round(p_round uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.doch1_rounds r where r.id = p_round and p_day between r.starts_on and r.ends_on
  )
$$;
--> statement-breakpoint

create or replace function app.doch1_status_round(p_status uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.round_id from public.doch1_statuses s where s.id = p_status
$$;
--> statement-breakpoint

revoke all on function app.doch1_person_unit(uuid), app.doch1_day_open(uuid, date), app.doch1_day_in_round(uuid, date), app.doch1_status_round(uuid) from public;
--> statement-breakpoint
grant execute on function app.doch1_person_unit(uuid), app.doch1_day_open(uuid, date), app.doch1_day_in_round(uuid, date), app.doch1_status_round(uuid) to authenticated;
--> statement-breakpoint

-- ── The day guard ───────────────────────────────────────────────────────────
-- GD001: the day is locked for this user (today after the lock time, or a past day).
--        Checked for users (role authenticated) only; trusted owner jobs are not locked.
-- GD002: the day is outside the round's dates.
-- Also: a day's status must belong to the same round, and updated_by is always the acting user.
-- Not SECURITY DEFINER, so current_user is the writer's role; the reads go through
-- the SECURITY DEFINER helpers above.
create or replace function app.doch1_days_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_is_user boolean := current_user = 'authenticated';
begin
  if tg_op in ('UPDATE', 'DELETE') and v_is_user and not app.doch1_day_open(old.round_id, old.day) then
    raise exception 'day locked' using errcode = 'GD001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_is_user and not app.doch1_day_open(new.round_id, new.day) then
    raise exception 'day locked' using errcode = 'GD001';
  end if;
  if not app.doch1_day_in_round(new.round_id, new.day) then
    raise exception 'day outside the round' using errcode = 'GD002';
  end if;
  if app.doch1_status_round(new.status_id) is distinct from new.round_id then
    raise exception 'status belongs to another round' using errcode = '23514';
  end if;
  if app.current_user_id() is not null then
    new.updated_by := app.current_user_id();
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_days_guard before insert or update or delete on public.doch1_days for each row execute function app.doch1_days_guard();
--> statement-breakpoint
revoke all on function app.doch1_days_guard() from public;
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.doch1_rounds, public.doch1_round_companies, public.doch1_statuses, public.doch1_import_mappings to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_members to authenticated;
--> statement-breakpoint
grant update (in_report, dmh_category, arrival_forecast, call_up_on, enlistment_status, has_disc, notes, sheet_tab, sheet_row) on public.doch1_members to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_days to authenticated;
--> statement-breakpoint
grant update (status_id, updated_by, updated_at) on public.doch1_days to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.doch1_push_subscriptions to authenticated;
--> statement-breakpoint
grant select, insert on public.doch1_reminder_requests, public.doch1_brigade_log to authenticated;
--> statement-breakpoint
grant select on public.doch1_reminder_log to authenticated;
--> statement-breakpoint
grant usage on sequence public.doch1_reminder_log_id_seq, public.doch1_brigade_log_id_seq to authenticated;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger doch1_rounds_touch before update on public.doch1_rounds for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_round_companies_touch before update on public.doch1_round_companies for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_statuses_touch before update on public.doch1_statuses for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_members_touch before update on public.doch1_members for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_days_touch before update on public.doch1_days for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_import_mappings_touch before update on public.doch1_import_mappings for each row execute function app.touch_updated_at();
--> statement-breakpoint

create trigger doch1_rounds_audit after insert or update or delete on public.doch1_rounds for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_round_companies_audit after insert or update or delete on public.doch1_round_companies for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_statuses_audit after insert or update or delete on public.doch1_statuses for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_members_audit after insert or update or delete on public.doch1_members for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_days_audit after insert or update or delete on public.doch1_days for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_push_subscriptions_audit after insert or update or delete on public.doch1_push_subscriptions for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_reminder_requests_audit after insert or update or delete on public.doch1_reminder_requests for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_reminder_log_audit after insert or update or delete on public.doch1_reminder_log for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_brigade_log_audit after insert or update or delete on public.doch1_brigade_log for each row execute function app.audit();
--> statement-breakpoint
create trigger doch1_import_mappings_audit after insert or update or delete on public.doch1_import_mappings for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies: settings ──────────────────────────────────────────────────────

create policy doch1_rounds_select on public.doch1_rounds for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_rounds_insert on public.doch1_rounds for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_rounds_update on public.doch1_rounds for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_rounds_delete on public.doch1_rounds for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_round_companies_select on public.doch1_round_companies for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_round_companies_insert on public.doch1_round_companies for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_round_companies_update on public.doch1_round_companies for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_round_companies_delete on public.doch1_round_companies for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_statuses_select on public.doch1_statuses for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_statuses_insert on public.doch1_statuses for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_statuses_update on public.doch1_statuses for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_statuses_delete on public.doch1_statuses for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_import_mappings_select on public.doch1_import_mappings for select to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_import_mappings_insert on public.doch1_import_mappings for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_import_mappings_update on public.doch1_import_mappings for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_import_mappings_delete on public.doch1_import_mappings for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

-- ── Policies: soldier-linked rows ───────────────────────────────────────────

create policy doch1_members_select on public.doch1_members for select to authenticated
  using (app.has_role('doch1', null, app.doch1_person_unit(person_id)));
--> statement-breakpoint
create policy doch1_members_insert on public.doch1_members for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_members_update on public.doch1_members for update to authenticated
  using (app.has_role('doch1', array['admin', 'company_user'], app.doch1_person_unit(person_id)))
  with check (app.has_role('doch1', array['admin', 'company_user'], app.doch1_person_unit(person_id)));
--> statement-breakpoint
create policy doch1_members_delete on public.doch1_members for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_days_select on public.doch1_days for select to authenticated
  using (app.has_role('doch1', null, app.doch1_person_unit(person_id)));
--> statement-breakpoint
create policy doch1_days_insert on public.doch1_days for insert to authenticated
  with check (app.has_role('doch1', array['admin', 'company_user', 'platoon_commander'], app.doch1_person_unit(person_id)));
--> statement-breakpoint
create policy doch1_days_update on public.doch1_days for update to authenticated
  using (app.has_role('doch1', array['admin', 'company_user', 'platoon_commander'], app.doch1_person_unit(person_id)))
  with check (app.has_role('doch1', array['admin', 'company_user', 'platoon_commander'], app.doch1_person_unit(person_id)));
--> statement-breakpoint
create policy doch1_days_delete on public.doch1_days for delete to authenticated
  using (app.has_role('doch1', array['admin', 'company_user', 'platoon_commander'], app.doch1_person_unit(person_id)));
--> statement-breakpoint

-- ── Policies: reminders, brigade log ────────────────────────────────────────

create policy doch1_push_subscriptions_select on public.doch1_push_subscriptions for select to authenticated
  using (user_id = (select app.current_user_id()));
--> statement-breakpoint
create policy doch1_push_subscriptions_insert on public.doch1_push_subscriptions for insert to authenticated
  with check (user_id = (select app.current_user_id()) and (select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_push_subscriptions_delete on public.doch1_push_subscriptions for delete to authenticated
  using (user_id = (select app.current_user_id()));
--> statement-breakpoint

create policy doch1_reminder_requests_select on public.doch1_reminder_requests for select to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_reminder_requests_insert on public.doch1_reminder_requests for insert to authenticated
  with check (
    (select app.has_role('doch1', array['admin']))
    and requested_by is not distinct from (select app.current_user_id())
  );
--> statement-breakpoint

create policy doch1_reminder_log_select on public.doch1_reminder_log for select to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint

create policy doch1_brigade_log_select on public.doch1_brigade_log for select to authenticated
  using ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_brigade_log_insert on public.doch1_brigade_log for insert to authenticated
  with check (
    (select app.has_role('doch1', array['admin']))
    and sent_by is not distinct from (select app.current_user_id())
  );
--> statement-breakpoint

-- ── people: doch1 admins and company users maintain their soldiers ──────────
-- (keeps the core and logistics clauses from 0001 / 0003; deleting stays with core admins)

drop policy people_insert on public.people;
--> statement-breakpoint
create policy people_insert on public.people for insert to authenticated
  with check (
    app.has_role('core', array['admin', 'editor'], unit_id)
    or app.has_role('logistics', array['admin'], unit_id)
    or app.has_role('doch1', array['admin', 'company_user'], unit_id)
  );
--> statement-breakpoint
drop policy people_update on public.people;
--> statement-breakpoint
create policy people_update on public.people for update to authenticated
  using (
    app.has_role('core', array['admin', 'editor'], unit_id)
    or app.has_role('logistics', array['admin'], unit_id)
    or app.has_role('doch1', array['admin', 'company_user'], unit_id)
  )
  with check (
    app.has_role('core', array['admin', 'editor'], unit_id)
    or app.has_role('logistics', array['admin'], unit_id)
    or app.has_role('doch1', array['admin', 'company_user'], unit_id)
  );
