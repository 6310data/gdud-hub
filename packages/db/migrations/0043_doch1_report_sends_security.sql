-- ════════════════════════════════════════════════════════════════════════════
-- דוח 1 "שליחת הדוח": privileges, RLS, the fill trigger, the closed-day rule in the day guard.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("doch1 report sends").
--
--   report sends: read   → anyone in doch1 (and a ניהול פלוגה admin, who opens the today screen)
--                 send   → admin / company_user / platoon_commander covering the unit, a day of the
--                          round up to today; always in the sender's name, now (the fill trigger)
--                 reopen → a doch1 admin covering the unit (delete; audited)
--                 notified_at → the cron job only (owner); users have no UPDATE
--   days: a soldier's day is closed once their unit, or a unit above it, sent that day's report:
--         a user write to it is refused (GD007) unless the user is a doch1 admin covering the
--         soldier. Same rule in the app (isDayWritable's `closed`, the today screen).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper functions ────────────────────────────────────────────────────────

-- Is this soldier's day closed for the current user? A send of their unit or a unit above it,
-- and the user is not a doch1 admin covering the soldier.
create or replace function app.doch1_day_closed(p_round uuid, p_person uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  with p as (select pp.unit_id from public.people pp where pp.id = p_person)
  select exists (
    select 1 from public.doch1_report_sends s
    where s.round_id = p_round and s.day = p_day
      and s.unit_id in (select app.unit_lineage((select unit_id from p)))
  ) and not app.has_role('doch1', array['admin'], (select unit_id from p))
$$;
--> statement-breakpoint

-- The sends of a day with the sender's name (users can't read app_users), for whoever reads the table.
create or replace function app.doch1_report_sends_of(p_round uuid, p_day date)
returns table (id uuid, unit_id uuid, sent_at timestamptz, sent_by_name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.unit_id, s.sent_at, coalesce(u.display_name, u.email)
  from public.doch1_report_sends s
  left join public.app_users u on u.id = s.sent_by
  where s.round_id = p_round and s.day = p_day
    and (app.has_module('doch1') or app.has_module('company', array['admin']))
$$;
--> statement-breakpoint

revoke all on function app.doch1_day_closed(uuid, uuid, date), app.doch1_report_sends_of(uuid, date) from public;
--> statement-breakpoint
grant execute on function app.doch1_day_closed(uuid, uuid, date), app.doch1_report_sends_of(uuid, date) to authenticated;
--> statement-breakpoint

-- ── The day guard (from 0005) + GD007 ───────────────────────────────────────
-- GD001: the day is locked for this user (today after the lock time, or a past day).
-- GD007: the day's report was sent (closed) and the user is not a doch1 admin covering the soldier.
-- GD002: the day is outside the round's dates.
-- Checked for users (role authenticated) only; trusted owner jobs (the import) are not locked.
create or replace function app.doch1_days_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_is_user boolean := current_user = 'authenticated';
begin
  if tg_op in ('UPDATE', 'DELETE') and v_is_user then
    if not app.doch1_day_open(old.round_id, old.day) then
      raise exception 'day locked' using errcode = 'GD001';
    end if;
    if app.doch1_day_closed(old.round_id, old.person_id, old.day) then
      raise exception 'report sent' using errcode = 'GD007';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_is_user and not app.doch1_day_open(new.round_id, new.day) then
    raise exception 'day locked' using errcode = 'GD001';
  end if;
  if v_is_user and app.doch1_day_closed(new.round_id, new.person_id, new.day) then
    raise exception 'report sent' using errcode = 'GD007';
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
revoke all on function app.doch1_days_guard() from public;
--> statement-breakpoint

-- ── A send is always the signed-in user's, now; notified_at is the job's ────
create or replace function app.doch1_report_sends_fill() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.sent_by := app.current_user_id();
    new.sent_at := now();
    new.notified_at := null;
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke all on function app.doch1_report_sends_fill() from public;
--> statement-breakpoint
create trigger doch1_report_sends_fill before insert on public.doch1_report_sends for each row execute function app.doch1_report_sends_fill();
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, delete on public.doch1_report_sends to authenticated;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger doch1_report_sends_touch before update on public.doch1_report_sends for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_report_sends_audit after insert or update or delete on public.doch1_report_sends for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

create policy doch1_report_sends_select on public.doch1_report_sends for select to authenticated
  using ((select app.has_module('doch1')) or (select app.has_module('company', array['admin'])));
--> statement-breakpoint
create policy doch1_report_sends_insert on public.doch1_report_sends for insert to authenticated
  with check (
    app.has_role('doch1', array['admin', 'company_user', 'platoon_commander'], unit_id)
    and app.doch1_day_in_round(round_id, day)
    and day <= (now() at time zone 'Asia/Jerusalem')::date
  );
--> statement-breakpoint
create policy doch1_report_sends_delete on public.doch1_report_sends for delete to authenticated
  using (app.has_role('doch1', array['admin'], unit_id));
