-- ════════════════════════════════════════════════════════════════════════════
-- מחלקת קשר → ציוד משלים on vehicles comes out of the company's signed stock (kesher_stock), not
-- straight out of the warehouse. `kesher_vehicle_stock.unit_id` = the company whose quantity it is
-- part of; null = a battalion vehicle (no company), which still takes it from the warehouse.
--
--   · the warehouse no longer counts company-sourced vehicle stock (the company's quantity already
--     holds it), so moving today's vehicle stock into its company's quantity keeps every number;
--   · a vehicle's ציוד משלים is always its own company's (or the warehouse's, on a battalion
--     vehicle); a company never has more on its vehicles than it signed for (guard on
--     kesher_vehicle_stock), and its quantity never drops below what is on its vehicles (guard on
--     kesher_stock — זיכוי takes the gear off the vehicle first);
--   · when דוח 1 moves a vehicle to another company (or to / from the battalion), the kesher gear on
--     it goes with it: its ציוד משלים moves from the old company's quantity (or the warehouse) to the
--     new one's, and the צ׳ mounted on it are signed over — זיכוי from the old place and החתמה to the
--     new one in kesher's יומן (the screen asks first: app.vehicle_kesher_gear);
--   · app.company_vehicle_stock: the company admin, or a kesher user covering the company, sets an
--     item's quantity on one of the company's vehicles out of the company's free (not-on-a-vehicle)
--     quantity; app.company_vehicle_options lists what the company holds with how much is free;
--   · app.kesher_vehicles() now says which company a vehicle belongs to.
-- Tested in packages/db/test/rls.test.ts ("company" → "vehicles (רכבים)").
--
-- Error codes (apps/web/src/lib/company/errors.ts, lib/action-result.ts):
--   GD120 not enough free in the company      GD121 the vehicle / צ׳ isn't the company's
--   GD122 the company's quantity would drop below what is on its vehicles
-- ════════════════════════════════════════════════════════════════════════════

-- ── Today's vehicle stock moves into its company's quantity ─────────────────

insert into public.kesher_stock (item_id, unit_id, qty)
  select vs.item_id, v.unit_id, sum(vs.qty)::integer
  from public.kesher_vehicle_stock vs
  join public.doch1_vehicles v on v.id = vs.vehicle_id
  join public.units u on u.id = v.unit_id and u.kind = 'company'
  group by vs.item_id, v.unit_id
on conflict on constraint kesher_stock_item_unit do update set qty = public.kesher_stock.qty + excluded.qty;
--> statement-breakpoint
update public.kesher_vehicle_stock vs set unit_id = v.unit_id
from public.doch1_vehicles v, public.units u
where v.id = vs.vehicle_id and u.id = v.unit_id and u.kind = 'company';
--> statement-breakpoint

-- ── Guards ──────────────────────────────────────────────────────────────────

-- The company a vehicle's kesher gear belongs to: the vehicle's company, null for a battalion vehicle.
create or replace function app.kesher_vehicle_company(p_vehicle uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select v.unit_id from public.doch1_vehicles v join public.units u on u.id = v.unit_id and u.kind = 'company' where v.id = p_vehicle
$$;
--> statement-breakpoint

-- A vehicle carries ציוד משלים only, its own company's (or the warehouse's, on a battalion vehicle);
-- a company's part never exceeds what the company signed for.
create or replace function app.kesher_vehicle_stock_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_signed integer;
  v_on     integer;
begin
  if (select i.kind from public.kesher_items i where i.id = new.item_id) is distinct from 'bulk' then
    raise exception 'vehicle stock is kept for ציוד משלים (bulk items) only' using errcode = '23514';
  end if;
  if new.unit_id is distinct from app.kesher_vehicle_company(new.vehicle_id) then
    raise exception 'the gear on a vehicle is its company''s' using errcode = 'GD121';
  end if;
  if new.unit_id is not null then
    v_signed := coalesce((select st.qty from public.kesher_stock st where st.item_id = new.item_id and st.unit_id = new.unit_id), 0);
    v_on := new.qty + coalesce((
      select sum(vs.qty) from public.kesher_vehicle_stock vs
      where vs.item_id = new.item_id and vs.unit_id = new.unit_id and vs.id <> new.id
    ), 0);
    if v_on > v_signed then
      raise exception 'only % free in the company', greatest(v_signed - (v_on - new.qty), 0) using errcode = 'GD120';
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop trigger if exists kesher_vehicle_stock_guard on public.kesher_vehicle_stock;
--> statement-breakpoint
create trigger kesher_vehicle_stock_guard before insert or update on public.kesher_vehicle_stock for each row execute function app.kesher_vehicle_stock_guard();
--> statement-breakpoint

-- A company's quantity never drops below what is on its vehicles (take it off the vehicle first).
create or replace function app.kesher_stock_vehicles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_on integer;
begin
  if old.unit_id is null then
    return coalesce(new, old);
  end if;
  v_on := coalesce((select sum(vs.qty) from public.kesher_vehicle_stock vs where vs.item_id = old.item_id and vs.unit_id = old.unit_id), 0);
  if v_on > 0 and (tg_op = 'DELETE' or new.qty < v_on) then
    raise exception '% on the company''s vehicles', v_on using errcode = 'GD122';
  end if;
  return coalesce(new, old);
end
$$;
--> statement-breakpoint
create trigger kesher_stock_vehicles_guard before update or delete on public.kesher_stock for each row execute function app.kesher_stock_vehicles_guard();
--> statement-breakpoint
revoke all on function app.kesher_stock_vehicles_guard() from public;
--> statement-breakpoint

-- A vehicle moved to another company (or to / from the battalion): its kesher gear goes with it.
--   ציוד משלים  from the old company's quantity (or the warehouse) to the new company's (or the warehouse)
--   צ׳          mounted ones of the old place (the old company's, or warehouse תקינים on a battalion
--               vehicle) are signed to the new company (or return to the warehouse); their holder row
--               goes (kesher_serials_moved). A צ׳ that can't go on the new company's vehicle (another
--               company's, or תקול) is unmounted.
-- Each line is a זיכוי from the old company and an החתמה to the new one in kesher's יומן.
create or replace function app.kesher_vehicle_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_from      uuid := (select u.id from public.units u where u.id = old.unit_id and u.kind = 'company');
  v_to        uuid := (select u.id from public.units u where u.id = new.unit_id and u.kind = 'company');
  v_from_name text;
  v_to_name   text;
  v_note      text;
  v_serials   uuid[];
begin
  if v_from is not distinct from v_to then
    return new;
  end if;
  v_from_name := (select u.name from public.units u where u.id = v_from);
  v_to_name := (select u.name from public.units u where u.id = v_to);
  v_note := 'עם רכב ' || new.number || ': ' || coalesce(v_from_name, 'גדודי') || ' ← ' || coalesce(v_to_name, 'גדודי') || ' · דוח 1';

  -- ציוד משלים: the new place's quantity first, then the rows, then the old place's (the guards check each step)
  if v_to is not null then
    insert into public.kesher_stock (item_id, unit_id, qty)
      select vs.item_id, v_to, vs.qty from public.kesher_vehicle_stock vs where vs.vehicle_id = new.id
    on conflict on constraint kesher_stock_item_unit do update set qty = public.kesher_stock.qty + excluded.qty;
  end if;
  update public.kesher_vehicle_stock vs set unit_id = v_to where vs.vehicle_id = new.id;
  if v_from is not null then
    update public.kesher_stock st set qty = st.qty - vs.qty
    from public.kesher_vehicle_stock vs
    where vs.vehicle_id = new.id and st.item_id = vs.item_id and st.unit_id = v_from;
  end if;
  insert into public.kesher_events (kind, unit_id, company, item, qty, details)
    select x.kind::public.kesher_event_kind, x.unit_id, x.company, i.name, vs.qty, v_note
    from public.kesher_vehicle_stock vs
    join public.kesher_items i on i.id = vs.item_id
    cross join (values ('credit', v_from, v_from_name), ('sign', v_to, v_to_name)) as x(kind, unit_id, company)
    where vs.vehicle_id = new.id and x.unit_id is not null;

  -- צ׳ mounted on it that belong to the old place go to the new one
  v_serials := array(
    select s.id from public.kesher_serials s
    where s.vehicle = new.number
      and (case when v_from is null then s.location = 'warehouse' and s.condition = 'ok'
                else s.location = 'company' and s.unit_id = v_from end)
  );
  update public.kesher_serials s
  set location = case when v_to is null then 'warehouse' else 'company' end::public.kesher_location, unit_id = v_to
  where s.id = any (v_serials);
  insert into public.kesher_events (kind, unit_id, company, item, serial, qty, details)
    select x.kind::public.kesher_event_kind, x.unit_id, x.company, i.name, s.serial, 1, v_note
    from public.kesher_serials s
    join public.kesher_items i on i.id = s.item_id
    cross join (values ('credit', v_from, v_from_name), ('sign', v_to, v_to_name)) as x(kind, unit_id, company)
    where s.id = any (v_serials) and x.unit_id is not null;

  -- what can't ride on the new company's vehicle comes off it
  if v_to is not null then
    insert into public.kesher_events (kind, unit_id, company, item, serial, details)
      select 'serial_edit', s.unit_id, (select u.name from public.units u where u.id = s.unit_id), i.name, s.serial,
        'רכב: ' || new.number || ' ← ללא · הרכב עבר ל' || v_to_name
      from public.kesher_serials s join public.kesher_items i on i.id = s.item_id
      where s.vehicle = new.number and not (s.location = 'company' and s.unit_id = v_to);
    update public.kesher_serials s set vehicle = null
    where s.vehicle = new.number and not (s.location = 'company' and s.unit_id = v_to);
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger doch1_vehicles_kesher_moved after update of unit_id on public.doch1_vehicles
  for each row when (old.unit_id is distinct from new.unit_id) execute function app.kesher_vehicle_moved();
--> statement-breakpoint

-- What is on each vehicle, for the battalion admin who moves vehicles between companies (the screen
-- asks before the gear goes with the vehicle).
create or replace function app.vehicle_kesher_gear()
returns table (vehicle_id uuid, serials integer, bulk integer)
language sql stable security definer set search_path = '' as $$
  select v.id,
    (select count(*) from public.kesher_serials s where s.vehicle = v.number)::integer,
    coalesce((select sum(vs.qty) from public.kesher_vehicle_stock vs where vs.vehicle_id = v.id), 0)::integer
  from public.doch1_vehicles v
  where app.has_role('doch1', array['admin'])
$$;
--> statement-breakpoint
revoke all on function app.vehicle_kesher_gear() from public;
--> statement-breakpoint
grant execute on function app.vehicle_kesher_gear() to authenticated;
--> statement-breakpoint
revoke all on function app.kesher_vehicle_company(uuid), app.kesher_vehicle_moved() from public;
--> statement-breakpoint

-- ── Who edits the ציוד משלים on a company's vehicle ─────────────────────────

-- The vehicle's company, when the caller is its company admin or a kesher user / admin covering it.
create or replace function app.company_vehicle_gear_unit(p_vehicle uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit uuid := (select v.unit_id from public.doch1_vehicles v where v.id = p_vehicle);
begin
  if v_unit is null or (select u.kind from public.units u where u.id = v_unit) is distinct from 'company' then
    raise exception 'the vehicle is not a company''s' using errcode = 'GD121';
  end if;
  if not (app.has_role('company', array['admin'], v_unit) or app.has_role('kesher', array['admin', 'user'], v_unit)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_unit;
end
$$;
--> statement-breakpoint

-- What a company admin may put on a vehicle: the kesher צ׳ on the company (with the vehicle it is on,
-- if any), and the ציוד משלים the company holds with how much of it is not on a vehicle yet.
create or replace function app.company_vehicle_options(p_unit uuid)
returns table (kind text, id uuid, name text, serial text, vehicle text, available integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_role('company', array['admin'], p_unit) or app.has_role('kesher', array['admin', 'user'], p_unit)) then
    return;
  end if;
  return query
    select 'serial'::text, s.id, i.name, s.serial, s.vehicle, null::integer
    from public.kesher_serials s join public.kesher_items i on i.id = s.item_id
    where s.location = 'company' and s.unit_id = p_unit
    union all
    select 'bulk'::text, i.id, i.name, null::text, null::text,
      (st.qty - coalesce((select sum(vs.qty) from public.kesher_vehicle_stock vs where vs.item_id = i.id and vs.unit_id = p_unit), 0))::integer
    from public.kesher_stock st join public.kesher_items i on i.id = st.item_id
    where st.unit_id = p_unit and st.qty > 0 and i.kind = 'bulk';
end
$$;
--> statement-breakpoint

-- Set the quantity of a ציוד משלים item on one of the company's vehicles (0 = none), out of the
-- company's free quantity; a decrease frees it again. The warehouse doesn't change.
create or replace function app.company_vehicle_stock(p_vehicle uuid, p_item uuid, p_qty integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_unit   uuid := app.company_vehicle_gear_unit(p_vehicle);
  v_number text := (select v.number from public.doch1_vehicles v where v.id = p_vehicle);
  v_item   record;
  v_row    record;
  v_before integer;
  v_free   integer;
begin
  if p_qty is null or p_qty not between 0 and 9999 then
    raise exception 'quantity' using errcode = '23514';
  end if;
  -- the item row is the lock every move of it takes (lockBulk in the kesher actions)
  select i.id, i.name, i.kind into v_item from public.kesher_items i where i.id = p_item for update;
  if v_item.id is null or v_item.kind <> 'bulk' then
    raise exception 'not ציוד משלים' using errcode = '23514';
  end if;
  select vs.qty, vs.unit_id into v_row from public.kesher_vehicle_stock vs where vs.vehicle_id = p_vehicle and vs.item_id = p_item;
  v_before := coalesce(v_row.qty, 0);
  if v_before > 0 and v_row.unit_id is distinct from v_unit then
    raise exception 'the gear on this vehicle is not the company''s' using errcode = 'GD121';
  end if;
  if p_qty = v_before then
    return;
  end if;
  v_free := coalesce((select st.qty from public.kesher_stock st where st.item_id = p_item and st.unit_id = v_unit), 0)
    - coalesce((select sum(vs.qty) from public.kesher_vehicle_stock vs where vs.item_id = p_item and vs.unit_id = v_unit), 0);
  if p_qty - v_before > v_free then
    raise exception 'only % free in the company', greatest(v_free, 0) using errcode = 'GD120';
  end if;
  if p_qty = 0 then
    delete from public.kesher_vehicle_stock vs where vs.vehicle_id = p_vehicle and vs.item_id = p_item;
  elsif v_before = 0 then
    insert into public.kesher_vehicle_stock (vehicle_id, item_id, unit_id, qty) values (p_vehicle, p_item, v_unit, p_qty);
  else
    update public.kesher_vehicle_stock vs set qty = p_qty where vs.vehicle_id = p_vehicle and vs.item_id = p_item;
  end if;
  insert into public.kesher_events (kind, unit_id, company, item, qty, details)
  values ('vehicle_stock', v_unit, (select u.name from public.units u where u.id = v_unit), v_item.name, p_qty,
    'רכב ' || v_number || ': ' || v_before || ' ← ' || p_qty || ' · מציוד הפלוגה');
end
$$;
--> statement-breakpoint

-- דוח 1's vehicle list for kesher members, now with the company each vehicle belongs to.
drop function app.kesher_vehicles();
--> statement-breakpoint
create function app.kesher_vehicles()
returns table (id uuid, number text, kind text, state text, active boolean, standby text, unit_id uuid)
language sql stable security definer set search_path = '' as $$
  select v.id, v.number, v.kind, v.state, v.active,
    (
      select string_agg(t.name, ' · ' order by t.sort_order, t.name)
      from public.doch1_standby_teams t
      join public.doch1_rounds r on r.id = t.round_id and r.active
      where t.vehicle_id = v.id and t.active
    ),
    v.unit_id
  from public.doch1_vehicles v
  where app.has_module('kesher')
$$;
--> statement-breakpoint

revoke all on function app.company_vehicle_gear_unit(uuid), app.kesher_vehicles() from public;
--> statement-breakpoint
grant execute on function app.kesher_vehicles() to authenticated;
