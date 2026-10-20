-- ════════════════════════════════════════════════════════════════════════════
-- Logistics module: privileges, helper functions, RLS policies, triggers.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("logistics").
--
-- Who can do what (roles from packages/core/src/modules.ts):
--   catalogue, kit standard, serials (add/remove/condition) → battalion-wide logistics admin
--   sign-out / return / storage / forms of a soldier     → logistics admin covering the soldier's unit
--                                                          (a return sets the serial's condition through
--                                                          the logistics_assignments_guard trigger)
--   reading                                              → any logistics member; soldier-linked rows
--                                                          only when the membership covers that soldier
--   adding / editing soldiers (people)                   → also logistics admin on that unit
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper functions ────────────────────────────────────────────────────────

-- Unit of a soldier, without going through people's own RLS (used inside policies).
create or replace function app.person_unit(p_person uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.unit_id from public.people p where p.id = p_person and app.has_module('logistics')
$$;
--> statement-breakpoint

-- Serials that are currently signed out, for every logistics member — including serials
-- held by soldiers outside the member's scope (whose assignment rows they cannot read).
-- Exposes only serial ids, never who holds them.
create or replace function app.logistics_held_serials() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.serial_id from public.logistics_assignments a
  where a.returned_at is null and app.has_module('logistics')
$$;
--> statement-breakpoint

revoke all on function app.person_unit(uuid) from public;
--> statement-breakpoint
revoke all on function app.logistics_held_serials() from public;
--> statement-breakpoint
grant execute on function app.person_unit(uuid) to authenticated;
--> statement-breakpoint
grant execute on function app.logistics_held_serials() to authenticated;
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.logistics_items, public.logistics_kit_items to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.logistics_serials to authenticated;
--> statement-breakpoint
-- the serial number and item type never change; delete + add instead
grant update (condition, category) on public.logistics_serials to authenticated;
--> statement-breakpoint
-- assignments are never deleted (history); only these columns change after sign-out
grant select, insert on public.logistics_assignments to authenticated;
--> statement-breakpoint
grant update (notes, kit, returned_at, returned_to, return_notes) on public.logistics_assignments to authenticated;
--> statement-breakpoint
grant select, insert on public.logistics_storage to authenticated;
--> statement-breakpoint
grant update (released_at, notes) on public.logistics_storage to authenticated;
--> statement-breakpoint
-- forms and events are append-only
grant select, insert on public.logistics_forms, public.logistics_events to authenticated;
--> statement-breakpoint
grant usage on sequence public.logistics_events_id_seq to authenticated;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- Assignments: a closed (returned) row can't be reopened; closing it with a destination
-- sets the serial's condition. SECURITY DEFINER because company-scoped admins may return
-- items but may not edit serials directly — the return itself already passed RLS.
create or replace function app.logistics_assignments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.returned_at is not null and new.returned_at is null then
    raise exception 'a returned assignment cannot be reopened' using errcode = '42501';
  end if;
  if old.returned_at is null and new.returned_at is not null and new.returned_to is not null then
    update public.logistics_serials set condition = new.returned_to where id = new.serial_id;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger logistics_assignments_guard before update on public.logistics_assignments for each row execute function app.logistics_assignments_guard();
--> statement-breakpoint

create or replace function app.logistics_storage_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.released_at is not null and new.released_at is null then
    raise exception 'a released storage row cannot be reopened' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger logistics_storage_guard before update on public.logistics_storage for each row execute function app.logistics_storage_guard();
--> statement-breakpoint

-- A serial that is signed out can't be deleted (that would silently drop the open assignment).
create or replace function app.logistics_serials_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.logistics_assignments a where a.serial_id = old.id and a.returned_at is null) then
    raise exception 'serial is signed out' using errcode = '23503';
  end if;
  return old;
end
$$;
--> statement-breakpoint
create trigger logistics_serials_delete_guard before delete on public.logistics_serials for each row execute function app.logistics_serials_delete_guard();
--> statement-breakpoint

-- The log's actor name comes from the invite list, never from client input or the Google profile.
create or replace function app.logistics_events_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.actor_name := (
    select coalesce(u.display_name, u.email) from public.app_users u where u.id = app.current_user_id()
  );
  return new;
end
$$;
--> statement-breakpoint
create trigger logistics_events_actor before insert on public.logistics_events for each row execute function app.logistics_events_actor();
--> statement-breakpoint

revoke all on function app.logistics_assignments_guard(), app.logistics_storage_guard(), app.logistics_serials_delete_guard(), app.logistics_events_actor() from public;
--> statement-breakpoint

create trigger logistics_items_touch before update on public.logistics_items for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger logistics_kit_items_touch before update on public.logistics_kit_items for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger logistics_serials_touch before update on public.logistics_serials for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger logistics_assignments_touch before update on public.logistics_assignments for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger logistics_storage_touch before update on public.logistics_storage for each row execute function app.touch_updated_at();
--> statement-breakpoint

create trigger logistics_items_audit after insert or update or delete on public.logistics_items for each row execute function app.audit();
--> statement-breakpoint
create trigger logistics_kit_items_audit after insert or update or delete on public.logistics_kit_items for each row execute function app.audit();
--> statement-breakpoint
create trigger logistics_serials_audit after insert or update or delete on public.logistics_serials for each row execute function app.audit();
--> statement-breakpoint
create trigger logistics_assignments_audit after insert or update or delete on public.logistics_assignments for each row execute function app.audit();
--> statement-breakpoint
create trigger logistics_storage_audit after insert or update or delete on public.logistics_storage for each row execute function app.audit();
--> statement-breakpoint
create trigger logistics_forms_audit after insert or update or delete on public.logistics_forms for each row execute function app.audit();
--> statement-breakpoint
create trigger logistics_events_audit after insert or update or delete on public.logistics_events for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies: catalogue ─────────────────────────────────────────────────────

create policy logistics_items_select on public.logistics_items for select to authenticated
  using ((select app.has_module('logistics')));
--> statement-breakpoint
create policy logistics_items_insert on public.logistics_items for insert to authenticated
  with check ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint
create policy logistics_items_update on public.logistics_items for update to authenticated
  using ((select app.has_role('logistics', array['admin'])))
  with check ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint
create policy logistics_items_delete on public.logistics_items for delete to authenticated
  using ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint

create policy logistics_kit_items_select on public.logistics_kit_items for select to authenticated
  using ((select app.has_module('logistics')));
--> statement-breakpoint
create policy logistics_kit_items_insert on public.logistics_kit_items for insert to authenticated
  with check ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint
create policy logistics_kit_items_update on public.logistics_kit_items for update to authenticated
  using ((select app.has_role('logistics', array['admin'])))
  with check ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint
create policy logistics_kit_items_delete on public.logistics_kit_items for delete to authenticated
  using ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint

-- ── Policies: serials ───────────────────────────────────────────────────────

create policy logistics_serials_select on public.logistics_serials for select to authenticated
  using ((select app.has_module('logistics')));
--> statement-breakpoint
create policy logistics_serials_insert on public.logistics_serials for insert to authenticated
  with check ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint
-- returns by company-scoped admins change the condition via app.logistics_assignments_guard()
create policy logistics_serials_update on public.logistics_serials for update to authenticated
  using ((select app.has_role('logistics', array['admin'])))
  with check ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint
create policy logistics_serials_delete on public.logistics_serials for delete to authenticated
  using ((select app.has_role('logistics', array['admin'])));
--> statement-breakpoint

-- ── Policies: soldier-linked rows ───────────────────────────────────────────

create policy logistics_assignments_select on public.logistics_assignments for select to authenticated
  using (app.has_role('logistics', null, app.person_unit(person_id)));
--> statement-breakpoint
create policy logistics_assignments_insert on public.logistics_assignments for insert to authenticated
  with check (
    app.has_role('logistics', array['admin'], app.person_unit(person_id))
    and signed_by is not distinct from app.current_user_id()
  );
--> statement-breakpoint
create policy logistics_assignments_update on public.logistics_assignments for update to authenticated
  using (app.has_role('logistics', array['admin'], app.person_unit(person_id)))
  with check (app.has_role('logistics', array['admin'], app.person_unit(person_id)));
--> statement-breakpoint

create policy logistics_storage_select on public.logistics_storage for select to authenticated
  using (app.has_role('logistics', null, app.person_unit(person_id)));
--> statement-breakpoint
create policy logistics_storage_insert on public.logistics_storage for insert to authenticated
  with check (app.has_role('logistics', array['admin'], app.person_unit(person_id)));
--> statement-breakpoint
create policy logistics_storage_update on public.logistics_storage for update to authenticated
  using (app.has_role('logistics', array['admin'], app.person_unit(person_id)))
  with check (app.has_role('logistics', array['admin'], app.person_unit(person_id)));
--> statement-breakpoint

create policy logistics_forms_select on public.logistics_forms for select to authenticated
  using (app.has_role('logistics', null, app.person_unit(person_id)));
--> statement-breakpoint
create policy logistics_forms_insert on public.logistics_forms for insert to authenticated
  with check (
    app.has_role('logistics', array['admin'], app.person_unit(person_id))
    and created_by is not distinct from app.current_user_id()
  );
--> statement-breakpoint

-- events without a soldier (stock changes) are visible to every logistics member
create policy logistics_events_select on public.logistics_events for select to authenticated
  using (
    (select app.has_module('logistics'))
    and (person_id is null or app.has_role('logistics', null, app.person_unit(person_id)))
  );
--> statement-breakpoint
create policy logistics_events_insert on public.logistics_events for insert to authenticated
  with check (
    (select app.has_module('logistics', array['admin']))
    and actor_user_id is not distinct from app.current_user_id()
    and case
      -- stock events (no soldier) are visible battalion-wide: battalion admins only
      when person_id is null then (select app.has_role('logistics', array['admin']))
      else app.has_role('logistics', array['admin'], app.person_unit(person_id))
    end
  );
--> statement-breakpoint

-- ── people: logistics admins maintain the אלפון for their units ─────────────
-- (deleting stays with core admins; logistics marks soldiers inactive instead)

drop policy people_insert on public.people;
--> statement-breakpoint
create policy people_insert on public.people for insert to authenticated
  with check (
    app.has_role('core', array['admin', 'editor'], unit_id)
    or app.has_role('logistics', array['admin'], unit_id)
  );
--> statement-breakpoint
drop policy people_update on public.people;
--> statement-breakpoint
create policy people_update on public.people for update to authenticated
  using (
    app.has_role('core', array['admin', 'editor'], unit_id)
    or app.has_role('logistics', array['admin'], unit_id)
  )
  with check (
    app.has_role('core', array['admin', 'editor'], unit_id)
    or app.has_role('logistics', array['admin'], unit_id)
  );
