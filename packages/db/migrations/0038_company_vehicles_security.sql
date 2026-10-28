-- ════════════════════════════════════════════════════════════════════════════
-- ניהול פלוגה → רכבים (spec "Changes requested 2026-10-28", item 6): each of the company's vehicles
-- (doch1_vehicles.unit_id) with the kesher צ׳ mounted on it, its ציוד משלים and the standby team that
-- uses it. The company admin edits the kesher gear with the same rules and events as /kesher/vehicles
-- (call 34): mount / unmount a צ׳ that is on the company (its location doesn't change, call 35); set
-- ציוד משלים quantities — an increase comes out of the kesher warehouse (needs that many תקינים there),
-- a decrease returns to it. Every change is a kesher `serial_edit` / `vehicle_stock` event in the
-- company's name with who made it, so kesher sees it in its יומן.
-- Tested in packages/db/test/rls.test.ts ("company" → "vehicles").
--
-- Error codes (apps/web/src/lib/company/errors.ts):
--   GD120 not enough תקינים in the kesher warehouse     GD121 the vehicle / צ׳ isn't the company's
-- ════════════════════════════════════════════════════════════════════════════

-- The company's vehicles with the standby team (of the active round) that uses each, for its members.
create or replace function app.company_vehicles(p_unit uuid)
returns table (id uuid, number text, kind text, state text, active boolean, team_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_member(p_unit) then
    return;
  end if;
  return query
    select v.id, v.number, v.kind, v.state, v.active,
      (
        select string_agg(t.name, ', ' order by t.name)
        from public.doch1_standby_teams t join public.doch1_rounds r on r.id = t.round_id and r.state = 'active'
        where t.vehicle_id = v.id
      )
    from public.doch1_vehicles v
    where v.unit_id = p_unit;
end
$$;
--> statement-breakpoint

-- The kesher gear on the company's vehicles: mounted צ׳ (kind 'serial') and ציוד משלים ('bulk').
create or replace function app.company_vehicle_gear(p_unit uuid)
returns table (vehicle_id uuid, kind text, item_id uuid, item text, serial_id uuid, serial text, qty integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_member(p_unit) then
    return;
  end if;
  return query
    select v.id, 'serial'::text, i.id, i.name, s.id, s.serial, 1
    from public.doch1_vehicles v
    join public.kesher_serials s on s.vehicle = v.number
    join public.kesher_items i on i.id = s.item_id
    where v.unit_id = p_unit
    union all
    select v.id, 'bulk'::text, i.id, i.name, null::uuid, null::text, vs.qty
    from public.doch1_vehicles v
    join public.kesher_vehicle_stock vs on vs.vehicle_id = v.id
    join public.kesher_items i on i.id = vs.item_id
    where v.unit_id = p_unit;
end
$$;
--> statement-breakpoint

-- What a company admin may put on a vehicle: the kesher צ׳ on the company (with the vehicle it is on,
-- if any), and every ציוד משלים item with how many תקינים the warehouse has.
create or replace function app.company_vehicle_options(p_unit uuid)
returns table (kind text, id uuid, name text, serial text, vehicle text, available integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role('company', array['admin'], p_unit) then
    return;
  end if;
  return query
    select 'serial'::text, s.id, i.name, s.serial, s.vehicle, null::integer
    from public.kesher_serials s join public.kesher_items i on i.id = s.item_id
    where s.location = 'company' and s.unit_id = p_unit
    union all
    select 'bulk'::text, i.id, i.name, null::text, null::text,
      (coalesce(i.brigade_qty, 0)
        - coalesce((select sum(st.qty) from public.kesher_stock st where st.item_id = i.id and st.unit_id is not null), 0)
        - coalesce((select sum(vs.qty) from public.kesher_vehicle_stock vs where vs.item_id = i.id), 0)
        - i.broken_qty)::integer
    from public.kesher_items i
    where i.kind = 'bulk';
end
$$;
--> statement-breakpoint

-- The company admin of the vehicle's company, and the vehicle's company (raises otherwise).
create or replace function app.company_vehicle_admin(p_vehicle uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit uuid := (select v.unit_id from public.doch1_vehicles v where v.id = p_vehicle);
begin
  if v_unit is null then
    raise exception 'the vehicle is not a company''s' using errcode = 'GD121';
  end if;
  if not app.has_role('company', array['admin'], v_unit) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_unit;
end
$$;
--> statement-breakpoint

-- Mount (p_on) or unmount a kesher צ׳ of the company on one of its vehicles. Its location never changes.
create or replace function app.company_vehicle_mount(p_vehicle uuid, p_serial uuid, p_on boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_unit   uuid := app.company_vehicle_admin(p_vehicle);
  v_number text := (select v.number from public.doch1_vehicles v where v.id = p_vehicle);
  v_s      record;
  v_next   text;
begin
  select s.id, s.serial, s.vehicle, s.unit_id, s.location, i.name as item into v_s
  from public.kesher_serials s join public.kesher_items i on i.id = s.item_id
  where s.id = p_serial
  for update of s;
  if v_s.id is null or v_s.unit_id is distinct from v_unit or v_s.location <> 'company' then
    raise exception 'the serial is not on this company' using errcode = 'GD121';
  end if;
  if not p_on and v_s.vehicle is distinct from v_number then
    raise exception 'the serial is not on this vehicle' using errcode = 'GD121';
  end if;
  v_next := case when p_on then v_number end;
  if v_s.vehicle is not distinct from v_next then
    return;
  end if;
  update public.kesher_serials s set vehicle = v_next where s.id = v_s.id;
  insert into public.kesher_events (kind, unit_id, company, item, serial, details)
  values ('serial_edit', v_unit, (select u.name from public.units u where u.id = v_unit), v_s.item, v_s.serial,
    'רכב: ' || coalesce(v_s.vehicle, 'ללא') || ' ← ' || coalesce(v_next, 'ללא') || ' · ניהול פלוגה');
end
$$;
--> statement-breakpoint

-- Set the quantity of a ציוד משלים item on one of the company's vehicles (0 = none). An increase
-- comes out of the warehouse's תקינים, a decrease goes back.
create or replace function app.company_vehicle_stock(p_vehicle uuid, p_item uuid, p_qty integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_unit      uuid := app.company_vehicle_admin(p_vehicle);
  v_number    text := (select v.number from public.doch1_vehicles v where v.id = p_vehicle);
  v_item      record;
  v_before    integer;
  v_available integer;
begin
  if p_qty is null or p_qty not between 0 and 9999 then
    raise exception 'quantity' using errcode = '23514';
  end if;
  -- the item row is the lock every move of it takes (lockBulk in the kesher actions)
  select i.id, i.name, i.kind, i.brigade_qty, i.broken_qty into v_item from public.kesher_items i where i.id = p_item for update;
  if v_item.id is null or v_item.kind <> 'bulk' then
    raise exception 'not ציוד משלים' using errcode = '23514';
  end if;
  v_before := coalesce((select vs.qty from public.kesher_vehicle_stock vs where vs.vehicle_id = p_vehicle and vs.item_id = p_item), 0);
  if p_qty = v_before then
    return;
  end if;
  v_available := coalesce(v_item.brigade_qty, 0)
    - coalesce((select sum(st.qty) from public.kesher_stock st where st.item_id = p_item and st.unit_id is not null), 0)
    - coalesce((select sum(vs.qty) from public.kesher_vehicle_stock vs where vs.item_id = p_item), 0)
    - v_item.broken_qty;
  if p_qty - v_before > v_available then
    raise exception 'only % in the warehouse', greatest(v_available, 0) using errcode = 'GD120';
  end if;
  if p_qty = 0 then
    delete from public.kesher_vehicle_stock vs where vs.vehicle_id = p_vehicle and vs.item_id = p_item;
  elsif v_before = 0 then
    insert into public.kesher_vehicle_stock (vehicle_id, item_id, qty) values (p_vehicle, p_item, p_qty);
  else
    update public.kesher_vehicle_stock vs set qty = p_qty where vs.vehicle_id = p_vehicle and vs.item_id = p_item;
  end if;
  insert into public.kesher_events (kind, unit_id, company, item, qty, details)
  values ('vehicle_stock', v_unit, (select u.name from public.units u where u.id = v_unit), v_item.name, p_qty,
    'רכב ' || v_number || ': ' || v_before || ' ← ' || p_qty || ' · ניהול פלוגה');
end
$$;
--> statement-breakpoint

revoke all on function app.company_vehicles(uuid), app.company_vehicle_gear(uuid), app.company_vehicle_options(uuid),
  app.company_vehicle_admin(uuid), app.company_vehicle_mount(uuid, uuid, boolean), app.company_vehicle_stock(uuid, uuid, integer) from public;
--> statement-breakpoint
grant execute on function app.company_vehicles(uuid), app.company_vehicle_gear(uuid), app.company_vehicle_options(uuid),
  app.company_vehicle_mount(uuid, uuid, boolean), app.company_vehicle_stock(uuid, uuid, integer) to authenticated;
