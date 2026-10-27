-- ════════════════════════════════════════════════════════════════════════════
-- דוח 1 round planning: the value lists of צפי הגעה / סטטוס גיוס, the member columns that point
-- at them, the pending company move. Spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md.
-- Tested in packages/db/test/rls.test.ts ("doch1 round planning").
--
--   field options (both lists)     → battalion-wide doch1 admin writes; everyone in doch1 reads
--   members.arrival_option_id,
--   members.enlistment_option_id   → admin / company_user covering the soldier (the members policy)
--                                    GD003: the value belongs to the other list
--   members.planned_unit_id        → battalion-wide doch1 admin only (GD004)
--   rounds.state                   → the existing rounds policies (battalion admin)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Backfill: the free-text values become each round's lists ───────────────
-- Every existing value starts as arriving / pending; the admin sets the real effects in settings.

insert into public.doch1_field_options (round_id, field, name, effect, sort_order)
select round_id, 'arrival', v, 'arriving', (row_number() over (partition by round_id order by v))::int - 1
from (select distinct round_id, left(btrim(arrival_forecast), 30) as v from public.doch1_members where btrim(coalesce(arrival_forecast, '')) <> '') s;
--> statement-breakpoint
insert into public.doch1_field_options (round_id, field, name, effect, sort_order)
select round_id, 'enlistment', v, 'pending', (row_number() over (partition by round_id order by v))::int - 1
from (select distinct round_id, left(btrim(enlistment_status), 30) as v from public.doch1_members where btrim(coalesce(enlistment_status, '')) <> '') s;
--> statement-breakpoint
update public.doch1_members m set arrival_option_id = o.id
from public.doch1_field_options o
where o.round_id = m.round_id and o.field = 'arrival' and o.name = left(btrim(m.arrival_forecast), 30);
--> statement-breakpoint
update public.doch1_members m set enlistment_option_id = o.id
from public.doch1_field_options o
where o.round_id = m.round_id and o.field = 'enlistment' and o.name = left(btrim(m.enlistment_status), 30);
--> statement-breakpoint

-- ── Member → option: same round (composite FK), blank when the value is deleted ──

alter table public.doch1_members
  add constraint doch1_members_arrival_option_fk foreign key (round_id, arrival_option_id)
  references public.doch1_field_options (round_id, id) on delete set null (arrival_option_id);
--> statement-breakpoint
alter table public.doch1_members
  add constraint doch1_members_enlistment_option_fk foreign key (round_id, enlistment_option_id)
  references public.doch1_field_options (round_id, id) on delete set null (enlistment_option_id);
--> statement-breakpoint

-- ── Guards ──────────────────────────────────────────────────────────────────
-- Not SECURITY DEFINER: the option lookup reads a settings table everyone in doch1 may read,
-- and current_user is the writer's role (trusted owner jobs are not limited, as in doch1_days_guard).

create or replace function app.doch1_member_options_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.arrival_option_id is not null
     and (select o.field from public.doch1_field_options o where o.id = new.arrival_option_id) is distinct from 'arrival' then
    raise exception 'not a צפי הגעה value' using errcode = 'GD003';
  end if;
  if new.enlistment_option_id is not null
     and (select o.field from public.doch1_field_options o where o.id = new.enlistment_option_id) is distinct from 'enlistment' then
    raise exception 'not a סטטוס גיוס value' using errcode = 'GD003';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_members_options_guard before insert or update of arrival_option_id, enlistment_option_id on public.doch1_members
  for each row execute function app.doch1_member_options_guard();
--> statement-breakpoint

create or replace function app.doch1_member_planned_unit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and new.planned_unit_id is distinct from (case when tg_op = 'UPDATE' then old.planned_unit_id end)
     and not app.has_role('doch1', array['admin']) then
    raise exception 'only the battalion admin moves a soldier between companies' using errcode = 'GD004';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_members_planned_unit_guard before insert or update of planned_unit_id on public.doch1_members
  for each row execute function app.doch1_member_planned_unit_guard();
--> statement-breakpoint
revoke all on function app.doch1_member_options_guard(), app.doch1_member_planned_unit_guard() from public;
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.doch1_field_options to authenticated;
--> statement-breakpoint
grant update (arrival_option_id, enlistment_option_id, planned_unit_id) on public.doch1_members to authenticated;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger doch1_field_options_touch before update on public.doch1_field_options for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger doch1_field_options_audit after insert or update or delete on public.doch1_field_options for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

create policy doch1_field_options_select on public.doch1_field_options for select to authenticated
  using ((select app.has_module('doch1')));
--> statement-breakpoint
create policy doch1_field_options_insert on public.doch1_field_options for insert to authenticated
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_field_options_update on public.doch1_field_options for update to authenticated
  using ((select app.has_role('doch1', array['admin'])))
  with check ((select app.has_role('doch1', array['admin'])));
--> statement-breakpoint
create policy doch1_field_options_delete on public.doch1_field_options for delete to authenticated
  using ((select app.has_role('doch1', array['admin'])));
