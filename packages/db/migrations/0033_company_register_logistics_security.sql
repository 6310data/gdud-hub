-- ════════════════════════════════════════════════════════════════════════════
-- ניהול פלוגה: logistics gear joins the company register (spec: "Changes requested 2026-10-28",
-- item 2). Register only, as with kesher: a logistics צ׳ with an open logistics_assignments row on an
-- active soldier of the company can be signed internally; "from" is that soldier (or the receiver of
-- the open entry). אפסון items aren't offered (they aren't in hand). No logistics table is written.
-- Tested in packages/db/test/rls.test.ts ("company" → "register").
-- ════════════════════════════════════════════════════════════════════════════

-- Where a piece of gear is now: the receiver of its open entry, else its usual place — the kesher
-- holder (or signer), the logistics soldier it is signed on, or nobody (the company) for a company item.
create or replace function app.company_gear_now(p_kesher_serial uuid, p_item uuid, p_logistics_serial uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select s.to_person_id from public.company_signings s
      where s.returned_at is null and s.single
        and (s.kesher_serial_id = p_kesher_serial or s.company_item_id = p_item or s.logistics_serial_id = p_logistics_serial)
      limit 1
    ),
    (select coalesce(h.holder_person_id, h.signer_person_id) from public.kesher_holders h where h.serial_id = p_kesher_serial),
    (select a.person_id from public.logistics_assignments a where a.serial_id = p_logistics_serial and a.returned_at is null)
  )
$$;
--> statement-breakpoint
drop function app.company_gear_now(uuid, uuid);
--> statement-breakpoint

-- The company's logistics צ׳ that can be signed: open assignment on an active soldier of the company,
-- not in אפסון.
create or replace function app.company_logistics_serials(p_unit uuid)
returns table (serial_id uuid, person_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.serial_id, a.person_id
  from public.logistics_assignments a
  join public.people p on p.id = a.person_id
  where a.returned_at is null and p.active
    and p.unit_id in (select app.unit_subtree(p_unit))
    and not exists (
      select 1 from public.logistics_storage st where st.serial_id = a.serial_id and st.released_at is null
    )
$$;
--> statement-breakpoint

create or replace function app.company_register_items(p_unit uuid)
returns table (
  kind text, id uuid, name text, category text, serial text, quantity integer, available integer,
  now_person_id uuid, now_name text, now_unit_id uuid, open_signing_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_member(p_unit) then
    return;
  end if;
  return query
    with opened as (
      select s.* from public.company_signings s where s.unit_id = p_unit and s.returned_at is null
    )
    select 'kesher'::text, ks.id, ki.name, ki.category, ks.serial, 1, case when o.id is null then 1 else 0 end,
      np.id, np.full_name, np.unit_id, o.id
    from public.kesher_serials ks
    join public.kesher_items ki on ki.id = ks.item_id
    left join public.kesher_holders h on h.serial_id = ks.id
    left join opened o on o.kesher_serial_id = ks.id
    left join public.people np on np.id = coalesce(o.to_person_id, h.holder_person_id, h.signer_person_id)
    where ks.location = 'company' and ks.unit_id = p_unit
    union all
    select 'logistics'::text, ls.id, li.name, li.category, ls.serial, 1, case when o.id is null then 1 else 0 end,
      np.id, np.full_name, np.unit_id, o.id
    from app.company_logistics_serials(p_unit) cl
    join public.logistics_serials ls on ls.id = cl.serial_id
    join public.logistics_items li on li.id = ls.item_id
    left join opened o on o.logistics_serial_id = ls.id
    left join public.people np on np.id = coalesce(o.to_person_id, cl.person_id)
    union all
    select 'company'::text, ci.id, ci.name, ci.category, ci.serial, ci.quantity,
      ci.quantity - coalesce((select sum(o2.quantity)::integer from opened o2 where o2.company_item_id = ci.id), 0),
      np.id, np.full_name, np.unit_id, o.id
    from public.company_items ci
    left join opened o on o.company_item_id = ci.id and o.single
    left join public.people np on np.id = o.to_person_id
    where ci.unit_id = p_unit and ci.active;
end
$$;
--> statement-breakpoint

create or replace function app.company_register(p_unit uuid, p_open boolean, p_limit integer default 300)
returns table (
  id uuid, kind text, item text, serial text, quantity integer,
  from_person_id uuid, from_name text, from_unit_id uuid,
  to_person_id uuid, to_name text, to_unit_id uuid,
  signed_at timestamptz, signed_by_name text, returned_at timestamptz, returned_by_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_member(p_unit) then
    return;
  end if;
  return query
    select cs.id,
      case when cs.kesher_serial_id is not null then 'kesher' when cs.logistics_serial_id is not null then 'logistics' else 'company' end,
      coalesce(ki.name, li.name, ci.name), coalesce(ks.serial, ls.serial, ci.serial), cs.quantity,
      fp.id, fp.full_name, fp.unit_id, tp.id, tp.full_name, tp.unit_id,
      cs.signed_at, coalesce(su.display_name, su.email), cs.returned_at, coalesce(ru.display_name, ru.email)
    from public.company_signings cs
    left join public.kesher_serials ks on ks.id = cs.kesher_serial_id
    left join public.kesher_items ki on ki.id = ks.item_id
    left join public.logistics_serials ls on ls.id = cs.logistics_serial_id
    left join public.logistics_items li on li.id = ls.item_id
    left join public.company_items ci on ci.id = cs.company_item_id
    left join public.people fp on fp.id = cs.from_person_id
    join public.people tp on tp.id = cs.to_person_id
    left join public.app_users su on su.id = cs.signed_by
    left join public.app_users ru on ru.id = cs.returned_by
    where cs.unit_id = p_unit and (cs.returned_at is null) = p_open
    order by coalesce(cs.returned_at, cs.signed_at) desc
    limit greatest(1, least(coalesce(p_limit, 300), 1000));
end
$$;
--> statement-breakpoint

-- p_kind 'kesher' (kesher_serials.id), 'logistics' (logistics_serials.id) or 'company' (company_items.id).
create or replace function app.company_sign(p_kind text, p_id uuid, p_to uuid, p_quantity integer default 1) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me     uuid := app.current_user_id();
  v_unit   uuid;
  v_single boolean := true;
  v_qty    integer := coalesce(p_quantity, 1);
  v_total  integer;
  v_from   uuid;
  v_to_unit uuid;
  v_id     uuid;
  v_k      uuid := case when p_kind = 'kesher' then p_id end;
  v_c      uuid := case when p_kind = 'company' then p_id end;
  v_l      uuid := case when p_kind = 'logistics' then p_id end;
begin
  if v_me is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- one signing of a piece at a time
  perform pg_advisory_xact_lock(hashtextextended('company_sign:' || coalesce(p_id::text, ''), 0));

  if p_kind = 'kesher' then
    select s.unit_id into v_unit from public.kesher_serials s where s.id = p_id and s.location = 'company';
    v_qty := 1;
  elsif p_kind = 'logistics' then
    -- the company of the soldier it is signed on, if it is in hand (not in אפסון)
    select app.company_of(p.unit_id) into v_unit
    from public.logistics_assignments a join public.people p on p.id = a.person_id
    where a.serial_id = p_id and a.returned_at is null and p.active
      and not exists (select 1 from public.logistics_storage st where st.serial_id = p_id and st.released_at is null);
    v_qty := 1;
  elsif p_kind = 'company' then
    select i.unit_id, i.serial is not null, i.quantity into v_unit, v_single, v_total
    from public.company_items i where i.id = p_id and i.active;
    if v_single then
      v_qty := 1;
    end if;
  else
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if v_unit is null then
    raise exception 'the gear is not on a company' using errcode = 'GD112';
  end if;

  select p.unit_id into v_to_unit from public.people p where p.id = p_to and p.active;
  if v_to_unit is null or app.company_of(v_to_unit) is distinct from v_unit then
    raise exception 'the receiver is not an active soldier of this company' using errcode = 'GD113';
  end if;
  if v_qty not between 1 and 9999 then
    raise exception 'quantity' using errcode = 'GD111';
  end if;

  if v_single then
    v_from := app.company_gear_now(v_k, v_c, v_l);
    if v_from = p_to then
      raise exception 'the gear is already with this soldier' using errcode = 'GD110';
    end if;
  elsif v_qty > v_total - coalesce((
      select sum(s.quantity) from public.company_signings s where s.company_item_id = p_id and s.returned_at is null
    ), 0) then
    raise exception 'not enough left' using errcode = 'GD111';
  end if;

  if not (
    app.has_role('company', array['admin'], v_unit)
    or app.has_role('company', array['platoon_commander'], v_to_unit)
    or (v_from is not null and app.has_role('company', array['platoon_commander'], (select p.unit_id from public.people p where p.id = v_from)))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_single then
    update public.company_signings s
       set returned_at = now(), returned_by = v_me
     where s.returned_at is null and s.single
       and (s.kesher_serial_id = v_k or s.company_item_id = v_c or s.logistics_serial_id = v_l);
  end if;

  insert into public.company_signings (unit_id, company_item_id, kesher_serial_id, logistics_serial_id, quantity, single, from_person_id, to_person_id, signed_by)
  values (v_unit, v_c, v_k, v_l, v_qty, v_single, v_from, p_to, v_me)
  returning id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint

-- Adds logistics: the soldier's own logistics gear shows who has it now while lent (with_name), and
-- logistics gear the soldier got internally is under 'company'.
create or replace function app.person_gear(p_person uuid)
returns table (source text, item text, serial text, qty integer, since timestamptz, detail text, with_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_sees_person(p_person) then
    return;
  end if;
  return query
    select 'logistics'::text, i.name, s.serial, 1, a.signed_at,
      case when exists (
        select 1 from public.logistics_storage st where st.serial_id = a.serial_id and st.person_id = p_person and st.released_at is null
      ) then 'באפסון' end,
      (
        select tp.full_name from public.company_signings cs join public.people tp on tp.id = cs.to_person_id
        where cs.logistics_serial_id = a.serial_id and cs.returned_at is null and cs.to_person_id <> p_person
      )
    from public.logistics_assignments a
    join public.logistics_serials s on s.id = a.serial_id
    join public.logistics_items i on i.id = s.item_id
    where a.person_id = p_person and a.returned_at is null
    union all
    select 'logistics'::text, st.item_name, s.serial, 1, st.stored_at, 'באפסון'::text, null::text
    from public.logistics_storage st
    left join public.logistics_serials s on s.id = st.serial_id
    where st.person_id = p_person and st.released_at is null
      and (st.serial_id is null or not exists (
        select 1 from public.logistics_assignments a where a.serial_id = st.serial_id and a.person_id = p_person and a.returned_at is null
      ))
    union all
    select 'kesher'::text, i.name, s.serial, 1, h.signed_at,
      case
        when h.signer_person_id = p_person and h.holder_person_id = p_person then 'חותם ומחזיק'
        when h.signer_person_id = p_person then 'חותם על הפלוגה'
        else 'מחזיק בפלוגה'
      end,
      (
        select tp.full_name from public.company_signings cs join public.people tp on tp.id = cs.to_person_id
        where cs.kesher_serial_id = h.serial_id and cs.returned_at is null and cs.to_person_id <> p_person
      )
    from public.kesher_holders h
    join public.kesher_serials s on s.id = h.serial_id
    join public.kesher_items i on i.id = s.item_id
    where h.signer_person_id = p_person or h.holder_person_id = p_person
    union all
    select 'company'::text, coalesce(ki.name, li.name, ci.name), coalesce(ks.serial, ls.serial, ci.serial), cs.quantity, cs.signed_at,
      case when fp.id is null then 'מהפלוגה' else 'מ' || fp.full_name end,
      null::text
    from public.company_signings cs
    left join public.kesher_serials ks on ks.id = cs.kesher_serial_id
    left join public.kesher_items ki on ki.id = ks.item_id
    left join public.logistics_serials ls on ls.id = cs.logistics_serial_id
    left join public.logistics_items li on li.id = ls.item_id
    left join public.company_items ci on ci.id = cs.company_item_id
    left join public.people fp on fp.id = cs.from_person_id
    where cs.to_person_id = p_person and cs.returned_at is null;
end
$$;
--> statement-breakpoint

revoke all on function app.company_gear_now(uuid, uuid, uuid), app.company_logistics_serials(uuid) from public;
