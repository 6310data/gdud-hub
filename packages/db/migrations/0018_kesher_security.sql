-- ════════════════════════════════════════════════════════════════════════════
-- מחלקת קשר: privileges, guard triggers, RLS policies.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("kesher").
-- Spec: docs/superpowers/specs/2026-10-27-kesher-design.md ("Security").
--
-- Who can do what (roles from packages/core/src/modules.ts):
--   catalogue, תקן, settings, serials, stock     → read: any kesher member (not personal)
--                                                  write: battalion-wide kesher admin
--   holders (who signed / holds a צ׳)            → read: members covering the company
--                                                  insert / delete and signer columns: battalion admin
--                                                  holder columns: members covering the company
--   checks (דוח צ׳) and their lines             → read / file: members covering the company
--   events (יומן)                               → read: members covering the company, plus rows with
--                                                  no company and no soldier (warehouse, catalogue)
--
-- Kesher memberships are battalion-wide or on a company; "members covering unit_id" is the set form
-- of 0010_rls_scope_sets.sql: unit_scope('kesher') computed once per statement (null = everything).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.kesher_items, public.kesher_kit_items to authenticated;
--> statement-breakpoint
grant select, update (warehouse_tracked, check_stale_days) on public.kesher_settings to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.kesher_serials to authenticated;
--> statement-breakpoint
-- the serial number and its device type never change; delete + add instead
grant update (location, unit_id, vehicle, notes) on public.kesher_serials to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.kesher_holders to authenticated;
--> statement-breakpoint
-- serial_id and unit_id never change (unit_id follows the serial; moving the serial drops the row)
grant update (signer_person_id, signer_role, signed_at, holder_person_id, holder_role, frame) on public.kesher_holders to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.kesher_stock to authenticated;
--> statement-breakpoint
grant update (qty) on public.kesher_stock to authenticated;
--> statement-breakpoint
-- reports, their lines and the log are append-only; notified_at is set by trigger / the notification job
grant select, insert on public.kesher_checks, public.kesher_check_lines, public.kesher_events to authenticated;
--> statement-breakpoint
grant usage on sequence public.kesher_events_id_seq to authenticated;
--> statement-breakpoint

insert into public.kesher_settings (id) values (1) on conflict do nothing;
--> statement-breakpoint

-- ── Guard triggers ──────────────────────────────────────────────────────────

-- A צ׳ is of a device type (serial item) and sits on a company unit, never on a platoon.
create or replace function app.kesher_serials_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select i.kind from public.kesher_items i where i.id = new.item_id) is distinct from 'serial' then
    raise exception 'a serial needs a device type (serial item)' using errcode = '23514';
  end if;
  if new.unit_id is not null and (select u.kind from public.units u where u.id = new.unit_id) is distinct from 'company' then
    raise exception 'a serial can only be on a company' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_serials_guard before insert or update on public.kesher_serials for each row execute function app.kesher_serials_guard();
--> statement-breakpoint

-- Moving a צ׳ (a location fix or an import) drops its holder row: a holder never sits on a company
-- the צ׳ is not on. SECURITY DEFINER: the move already passed RLS (battalion admin).
create or replace function app.kesher_serials_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.kesher_holders h where h.serial_id = new.id and h.unit_id is distinct from new.unit_id;
  return null;
end
$$;
--> statement-breakpoint
create trigger kesher_serials_moved after update of unit_id, location on public.kesher_serials for each row execute function app.kesher_serials_moved();
--> statement-breakpoint

-- A צ׳ that is signed on a company can't be deleted (that would silently drop who holds it).
create or replace function app.kesher_serials_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.kesher_holders h where h.serial_id = old.id) then
    raise exception 'serial is signed on a company' using errcode = '23503';
  end if;
  return old;
end
$$;
--> statement-breakpoint
create trigger kesher_serials_delete_guard before delete on public.kesher_serials for each row execute function app.kesher_serials_delete_guard();
--> statement-breakpoint

-- Holders: unit_id comes from the serial; every soldier named is active and in the company's
-- subtree (checked on insert and whenever a person column changes — a soldier who later moves keeps
-- the holding, the overview flags it); only a battalion admin changes the signer columns.
-- SECURITY DEFINER: the soldier check needs the soldier's unit whatever the caller sees of people.
create or replace function app.kesher_holders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.unit_id := (select s.unit_id from public.kesher_serials s where s.id = new.serial_id);
    if new.unit_id is null then
      raise exception 'the serial is not on a company' using errcode = '23514';
    end if;
    new.signed_by := app.current_user_id();
  elsif (new.signer_person_id, new.signer_role, new.signed_at) is distinct from (old.signer_person_id, old.signer_role, old.signed_at)
    and not app.has_role('kesher', array['admin']) then
    raise exception 'only a battalion kesher admin changes who signed' using errcode = '42501';
  end if;
  if new.signer_person_id is not null and (tg_op = 'INSERT' or new.signer_person_id is distinct from old.signer_person_id)
    and not exists (
      select 1 from public.people p
      where p.id = new.signer_person_id and p.active and new.unit_id in (select app.unit_lineage(p.unit_id))
    ) then
    raise exception 'the signing soldier is not an active soldier of this company' using errcode = '23514';
  end if;
  if new.holder_person_id is not null and (tg_op = 'INSERT' or new.holder_person_id is distinct from old.holder_person_id)
    and not exists (
      select 1 from public.people p
      where p.id = new.holder_person_id and p.active and new.unit_id in (select app.unit_lineage(p.unit_id))
    ) then
    raise exception 'the holder is not an active soldier of this company' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_holders_guard before insert or update on public.kesher_holders for each row execute function app.kesher_holders_guard();
--> statement-breakpoint

-- ציוד משלים quantities: bulk items, on the warehouse (null) or a company; the warehouse goes below
-- zero only while it isn't tracked (the old "מלאי חלקי").
create or replace function app.kesher_stock_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select i.kind from public.kesher_items i where i.id = new.item_id) is distinct from 'bulk' then
    raise exception 'stock is kept for ציוד משלים (bulk items) only' using errcode = '23514';
  end if;
  if new.unit_id is not null and (select u.kind from public.units u where u.id = new.unit_id) is distinct from 'company' then
    raise exception 'stock can only be on a company or the warehouse' using errcode = '23514';
  end if;
  if new.unit_id is null and new.qty < 0
    and coalesce((select s.warehouse_tracked from public.kesher_settings s where s.id = 1), true) then
    raise exception 'warehouse quantity below zero' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_stock_guard before insert or update on public.kesher_stock for each row execute function app.kesher_stock_guard();
--> statement-breakpoint

-- תקן: a kit line is ציוד משלים (bulk), and the תקן never loops (a cascade must end).
create or replace function app.kesher_kit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select i.kind from public.kesher_items i where i.id = new.item_id) is distinct from 'bulk' then
    raise exception 'a kit line must be ציוד משלים (bulk item)' using errcode = '23514';
  end if;
  if exists (
    with recursive down(id, depth) as (
      select new.item_id, 0
      union all
      select k.item_id, down.depth + 1
      from public.kesher_kit_items k join down on k.parent_item_id = down.id
      where k.id <> new.id and down.depth < 32
    )
    select 1 from down where id = new.parent_item_id
  ) then
    raise exception 'kit cycle' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_kit_guard before insert or update on public.kesher_kit_items for each row execute function app.kesher_kit_guard();
--> statement-breakpoint

-- דוח צ׳: the reporter is the signed-in user, named from the invite list. Imported rows (sheet_key)
-- keep the sheet's reporter text, have no by_user and are marked notified so no job pushes old reports.
-- notified_at is never taken from client input.
create or replace function app.kesher_checks_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sheet_key is null then
    new.by_user := app.current_user_id();
    new.reporter_name := (select coalesce(u.display_name, u.email) from public.app_users u where u.id = new.by_user);
    new.notified_at := null;
  else
    new.by_user := null;
    new.notified_at := now();
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_checks_fill before insert on public.kesher_checks for each row execute function app.kesher_checks_fill();
--> statement-breakpoint

-- A line of a report filed in the app: added by its reporter, for a צ׳ that is on that company now.
-- (Imported reports keep their lines as the sheet had them — the צ׳ may have moved since.)
create or replace function app.kesher_check_lines_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_check record;
begin
  select c.unit_id, c.by_user, c.sheet_key into v_check from public.kesher_checks c where c.id = new.check_id;
  if v_check.sheet_key is null then
    if v_check.by_user is distinct from app.current_user_id() then
      raise exception 'only the reporter adds lines to a report' using errcode = '42501';
    end if;
    if new.serial_id is null or not exists (
      select 1 from public.kesher_serials s where s.id = new.serial_id and s.unit_id = v_check.unit_id
    ) then
      raise exception 'the serial is not on this company' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_check_lines_guard before insert on public.kesher_check_lines for each row execute function app.kesher_check_lines_guard();
--> statement-breakpoint

-- The log's actor name comes from the invite list, never from client input.
create or replace function app.kesher_events_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.actor_name := (
    select coalesce(u.display_name, u.email) from public.app_users u where u.id = app.current_user_id()
  );
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_events_actor before insert on public.kesher_events for each row execute function app.kesher_events_actor();
--> statement-breakpoint

revoke all on function app.kesher_serials_guard(), app.kesher_serials_moved(), app.kesher_serials_delete_guard(),
  app.kesher_holders_guard(), app.kesher_stock_guard(), app.kesher_kit_guard(), app.kesher_checks_fill(),
  app.kesher_check_lines_guard(), app.kesher_events_actor() from public;
--> statement-breakpoint

create trigger kesher_items_touch before update on public.kesher_items for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger kesher_kit_items_touch before update on public.kesher_kit_items for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger kesher_serials_touch before update on public.kesher_serials for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger kesher_holders_touch before update on public.kesher_holders for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger kesher_stock_touch before update on public.kesher_stock for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger kesher_settings_touch before update on public.kesher_settings for each row execute function app.touch_updated_at();
--> statement-breakpoint

create trigger kesher_items_audit after insert or update or delete on public.kesher_items for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_kit_items_audit after insert or update or delete on public.kesher_kit_items for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_serials_audit after insert or update or delete on public.kesher_serials for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_holders_audit after insert or update or delete on public.kesher_holders for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_stock_audit after insert or update or delete on public.kesher_stock for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_checks_audit after insert or update or delete on public.kesher_checks for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_check_lines_audit after insert or update or delete on public.kesher_check_lines for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_events_audit after insert or update or delete on public.kesher_events for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_settings_audit after insert or update or delete on public.kesher_settings for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies: not personal — every kesher member reads, battalion admin writes ──

create policy kesher_items_select on public.kesher_items for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_items_insert on public.kesher_items for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_items_update on public.kesher_items for update to authenticated
  using ((select app.has_role('kesher', array['admin'])))
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_items_delete on public.kesher_items for delete to authenticated
  using ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

create policy kesher_kit_items_select on public.kesher_kit_items for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_kit_items_insert on public.kesher_kit_items for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_kit_items_update on public.kesher_kit_items for update to authenticated
  using ((select app.has_role('kesher', array['admin'])))
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_kit_items_delete on public.kesher_kit_items for delete to authenticated
  using ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

create policy kesher_settings_select on public.kesher_settings for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_settings_update on public.kesher_settings for update to authenticated
  using ((select app.has_role('kesher', array['admin'])))
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

create policy kesher_serials_select on public.kesher_serials for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_serials_insert on public.kesher_serials for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_serials_update on public.kesher_serials for update to authenticated
  using ((select app.has_role('kesher', array['admin'])))
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_serials_delete on public.kesher_serials for delete to authenticated
  using ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

create policy kesher_stock_select on public.kesher_stock for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_stock_insert on public.kesher_stock for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_stock_update on public.kesher_stock for update to authenticated
  using ((select app.has_role('kesher', array['admin'])))
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_stock_delete on public.kesher_stock for delete to authenticated
  using ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

-- ── Policies: company-scoped ────────────────────────────────────────────────

create policy kesher_holders_select on public.kesher_holders for select to authenticated
  using ((select app.unit_scope('kesher')) is null or unit_id = any ((select app.unit_scope('kesher'))::uuid[]));
--> statement-breakpoint
create policy kesher_holders_insert on public.kesher_holders for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
-- holder columns by anyone covering the company; signer columns: battalion admin (kesher_holders_guard)
create policy kesher_holders_update on public.kesher_holders for update to authenticated
  using ((select app.unit_scope('kesher')) is null or unit_id = any ((select app.unit_scope('kesher'))::uuid[]))
  with check ((select app.unit_scope('kesher')) is null or unit_id = any ((select app.unit_scope('kesher'))::uuid[]));
--> statement-breakpoint
create policy kesher_holders_delete on public.kesher_holders for delete to authenticated
  using ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

create policy kesher_checks_select on public.kesher_checks for select to authenticated
  using ((select app.unit_scope('kesher')) is null or unit_id = any ((select app.unit_scope('kesher'))::uuid[]));
--> statement-breakpoint
-- imported reports (sheet_key) only from the battalion admin's import
create policy kesher_checks_insert on public.kesher_checks for insert to authenticated
  with check (
    ((select app.unit_scope('kesher')) is null or unit_id = any ((select app.unit_scope('kesher'))::uuid[]))
    and (sheet_key is null or (select app.has_role('kesher', array['admin'])))
  );
--> statement-breakpoint

create policy kesher_check_lines_select on public.kesher_check_lines for select to authenticated
  using (check_id in (select c.id from public.kesher_checks c));
--> statement-breakpoint
create policy kesher_check_lines_insert on public.kesher_check_lines for insert to authenticated
  with check (check_id in (select c.id from public.kesher_checks c));
--> statement-breakpoint

-- rows with no company and no soldier (warehouse stock, catalogue, imports) are visible to every member
create policy kesher_events_select on public.kesher_events for select to authenticated
  using (
    (select app.has_module('kesher'))
    and (
      (select app.unit_scope('kesher')) is null
      or unit_id = any ((select app.unit_scope('kesher'))::uuid[])
      or (unit_id is null and person_id is null)
    )
  );
--> statement-breakpoint
create policy kesher_events_insert on public.kesher_events for insert to authenticated
  with check (
    (select app.has_module('kesher'))
    and actor_user_id is not distinct from app.current_user_id()
    and case
      when unit_id is null then (select app.has_role('kesher', array['admin']))
      else (select app.unit_scope('kesher')) is null or unit_id = any ((select app.unit_scope('kesher'))::uuid[])
    end
  );
