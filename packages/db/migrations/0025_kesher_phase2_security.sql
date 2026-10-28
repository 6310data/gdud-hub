-- ════════════════════════════════════════════════════════════════════════════
-- מחלקת קשר, phase 2: תקין / תקול, the brigade, vehicles' ציוד משלים, צהוב בעיניים,
-- notification settings. Tested in packages/db/test/rls.test.ts ("kesher").
--
--   kesher_serials.condition        → update: battalion admin (as the other serial columns)
--   kesher_items.broken_qty         → kesher_items is already admin-written
--   kesher_vehicle_stock            → read: any kesher member; write: battalion admin
--   kesher_eye_checks               → read: any kesher member; add: battalion admin (מחלקת הקשר)
--   kesher_settings (new columns)   → admin; reminder_sent_on only by the notification job
--   app.kesher_vehicles()           → דוח 1's vehicle list and its standby teams, for kesher members
--   doch1_push_subscriptions        → a kesher member may subscribe too (one subscription serves both)
--
-- The new enum values ('brigade', the event kinds) are not used here: drizzle runs the migrations
-- in one transaction, where a value added by ALTER TYPE can't be used yet.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Privileges ──────────────────────────────────────────────────────────────

grant update (condition) on public.kesher_serials to authenticated;
--> statement-breakpoint
grant update (eye_warn_days, eye_alert_days, notify_missing, reminder_hour) on public.kesher_settings to authenticated;
--> statement-breakpoint
grant select, insert, delete on public.kesher_vehicle_stock to authenticated;
--> statement-breakpoint
grant update (qty) on public.kesher_vehicle_stock to authenticated;
--> statement-breakpoint
grant select, insert on public.kesher_eye_checks to authenticated;
--> statement-breakpoint

-- ── Guard triggers ──────────────────────────────────────────────────────────

-- A vehicle carries ציוד משלים (bulk items) only.
create or replace function app.kesher_vehicle_stock_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select i.kind from public.kesher_items i where i.id = new.item_id) is distinct from 'bulk' then
    raise exception 'vehicle stock is kept for ציוד משלים (bulk items) only' using errcode = '23514';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_vehicle_stock_guard before insert or update on public.kesher_vehicle_stock for each row execute function app.kesher_vehicle_stock_guard();
--> statement-breakpoint

-- צהוב בעיניים: who and when come from the session, never from client input.
create or replace function app.kesher_eye_checks_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.at := now();
  new.by_user := app.current_user_id();
  new.by_name := (select coalesce(u.display_name, u.email) from public.app_users u where u.id = new.by_user);
  return new;
end
$$;
--> statement-breakpoint
create trigger kesher_eye_checks_fill before insert on public.kesher_eye_checks for each row execute function app.kesher_eye_checks_fill();
--> statement-breakpoint

revoke all on function app.kesher_vehicle_stock_guard(), app.kesher_eye_checks_fill() from public;
--> statement-breakpoint

create trigger kesher_vehicle_stock_touch before update on public.kesher_vehicle_stock for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger kesher_vehicle_stock_audit after insert or update or delete on public.kesher_vehicle_stock for each row execute function app.audit();
--> statement-breakpoint
create trigger kesher_eye_checks_audit after insert or update or delete on public.kesher_eye_checks for each row execute function app.audit();
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

create policy kesher_vehicle_stock_select on public.kesher_vehicle_stock for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_vehicle_stock_insert on public.kesher_vehicle_stock for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_vehicle_stock_update on public.kesher_vehicle_stock for update to authenticated
  using ((select app.has_role('kesher', array['admin'])))
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint
create policy kesher_vehicle_stock_delete on public.kesher_vehicle_stock for delete to authenticated
  using ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

create policy kesher_eye_checks_select on public.kesher_eye_checks for select to authenticated
  using ((select app.has_module('kesher')));
--> statement-breakpoint
create policy kesher_eye_checks_insert on public.kesher_eye_checks for insert to authenticated
  with check ((select app.has_role('kesher', array['admin'])));
--> statement-breakpoint

-- ── דוח 1's vehicles, for kesher ────────────────────────────────────────────
-- A kesher member who isn't in דוח 1 still picks a vehicle from its list and sees which standby
-- team of the active round has it. Only vehicle fields and team names — no soldiers.
create or replace function app.kesher_vehicles()
returns table (id uuid, number text, kind text, state text, active boolean, standby text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.number, v.kind, v.state, v.active,
    (
      select string_agg(t.name, ' · ' order by t.sort_order, t.name)
      from public.doch1_standby_teams t
      join public.doch1_rounds r on r.id = t.round_id and r.active
      where t.vehicle_id = v.id and t.active
    )
  from public.doch1_vehicles v
  where app.has_module('kesher')
$$;
--> statement-breakpoint
revoke all on function app.kesher_vehicles() from public;
--> statement-breakpoint
grant execute on function app.kesher_vehicles() to authenticated;
--> statement-breakpoint

-- ── Push: one subscription per device, for דוח 1 and קשר alike ─────────────

alter policy doch1_push_subscriptions_insert on public.doch1_push_subscriptions
  with check (user_id = (select app.current_user_id()) and ((select app.has_module('doch1')) or (select app.has_module('kesher'))));
