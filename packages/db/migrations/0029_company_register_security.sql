-- ════════════════════════════════════════════════════════════════════════════
-- ניהול פלוגה, phase 2: החתמה פנימית — the company's own register.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("company" → "register").
-- Spec: docs/superpowers/specs/2026-10-28-company-design.md ("Internal signing").
--
--   company_items     read: members of the company · write: company admin
--   company_signings  read: members of the company, and the soldier who gave or got the gear
--                     write: only app.company_sign / app.company_return (SECURITY DEFINER), which
--                     fill "from" from where the gear is now, close the previous open entry, check
--                     the quantity and the caller's role:
--                       company admin               anything in the company
--                       platoon commander           when the gear is now with a soldier of their
--                                                   platoon (lending) or goes to one (borrowing)
-- Nothing here writes kesher_holders, kesher_events or any logistics table: the departments keep
-- their own records and never see the register.
--
-- "Members of the company" = a company membership on the company, above it, or on one of its
-- platoons (app.company_member_units()).
--
-- Error codes (apps/web/src/lib/company/errors.ts):
--   GD110 the gear is already with that soldier     GD111 not enough of a quantity item left
--   GD112 the gear isn't on this company            GD113 the receiver isn't an active soldier of it
--   GD114 the entry is already closed
-- ════════════════════════════════════════════════════════════════════════════

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select, insert, delete on public.company_items to authenticated;
--> statement-breakpoint
-- the company and the צ׳ of an item never change; add a new item instead
grant update (name, category, quantity, notes, active) on public.company_items to authenticated;
--> statement-breakpoint
grant select on public.company_signings to authenticated;
--> statement-breakpoint

-- ── Helper functions ────────────────────────────────────────────────────────

-- Companies the current user is a member of in ניהול פלוגה (a membership on the company, above it,
-- or below it). Null = all (super admin or a battalion-wide membership).
create or replace function app.company_member_units() returns uuid[]
language sql stable security definer set search_path = '' as $$
  with mine as (
    select m.unit_id
    from public.memberships m
    join public.app_users u on u.id = m.user_id
    where u.auth_user_id = auth.uid() and u.active and m.module = 'company'
  )
  select case
    when app.is_super_admin() or exists (select 1 from mine where unit_id is null) then null
    else coalesce((
      select array_agg(distinct c.id)
      from public.units c
      where c.kind = 'company'
        and exists (
          select 1 from mine
          where mine.unit_id in (select app.unit_lineage(c.id)) or c.id in (select app.unit_lineage(mine.unit_id))
        )
    ), '{}')
  end
$$;
--> statement-breakpoint

create or replace function app.company_member(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_unit is not null and (app.company_member_units() is null or p_unit = any (app.company_member_units()))
$$;
--> statement-breakpoint

-- Where a piece of gear is now (the receiver of its open entry), else its usual place: the kesher
-- holder (or signer) for a kesher צ׳, nobody (the company) for a company item.
create or replace function app.company_gear_now(p_kesher_serial uuid, p_item uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select s.to_person_id from public.company_signings s
      where s.returned_at is null and s.single
        and (s.kesher_serial_id = p_kesher_serial or s.company_item_id = p_item)
      limit 1
    ),
    (select coalesce(h.holder_person_id, h.signer_person_id) from public.kesher_holders h where h.serial_id = p_kesher_serial)
  )
$$;
--> statement-breakpoint

-- ── What can be signed, and to whom ─────────────────────────────────────────

-- For a member of the company: its kesher צ׳ (with where each is now) and its active items (with how
-- many are left). A platoon commander without a kesher membership picks a kesher צ׳ here without
-- getting kesher read access. Names only — no personal number, no phone.
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

-- The receiver picker: the company's active soldiers — id, name, unit. No personal number, no phone.
create or replace function app.company_soldier_names(p_unit uuid)
returns table (id uuid, full_name text, unit_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_member(p_unit) then
    return;
  end if;
  return query
    select p.id, p.full_name, p.unit_id from public.people p
    where p.active and p.unit_id in (select app.unit_subtree(p_unit));
end
$$;
--> statement-breakpoint

-- The register as a list, for a member of the company: open entries (p_open) or the history, newest
-- first, with the names of the soldiers and of who recorded it. A platoon commander sees every
-- platoon's entries here without getting the other platoons' people rows.
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
    select cs.id, case when cs.kesher_serial_id is null then 'company' else 'kesher' end,
      coalesce(ki.name, ci.name), coalesce(ks.serial, ci.serial), cs.quantity,
      fp.id, fp.full_name, fp.unit_id, tp.id, tp.full_name, tp.unit_id,
      cs.signed_at, coalesce(su.display_name, su.email), cs.returned_at, coalesce(ru.display_name, ru.email)
    from public.company_signings cs
    left join public.kesher_serials ks on ks.id = cs.kesher_serial_id
    left join public.kesher_items ki on ki.id = ks.item_id
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

-- ── Writing the register ────────────────────────────────────────────────────

-- Record that a kesher צ׳ (p_kind 'kesher', p_id = kesher_serials.id) or a company item (p_kind
-- 'company', p_id = company_items.id) is now with p_to. "From" is where it is now; an open entry for
-- the same piece is closed in the same transaction, so it is never in two places. Returns the entry.
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
begin
  if v_me is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- one signing of a piece at a time
  perform pg_advisory_xact_lock(hashtextextended('company_sign:' || coalesce(p_id::text, ''), 0));

  if p_kind = 'kesher' then
    select s.unit_id into v_unit from public.kesher_serials s where s.id = p_id and s.location = 'company';
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
    v_from := app.company_gear_now(case when p_kind = 'kesher' then p_id end, case when p_kind = 'company' then p_id end);
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
       and (s.kesher_serial_id = case when p_kind = 'kesher' then p_id end or s.company_item_id = case when p_kind = 'company' then p_id end);
  end if;

  insert into public.company_signings (unit_id, company_item_id, kesher_serial_id, quantity, single, from_person_id, to_person_id, signed_by)
  values (
    v_unit,
    case when p_kind = 'company' then p_id end,
    case when p_kind = 'kesher' then p_id end,
    v_qty, v_single, v_from, p_to, v_me
  )
  returning id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint

-- Close an open entry (הוחזר): the gear is back at its usual place. The company admin, or the platoon
-- commander of the soldier who has it or of the one it came from.
create or replace function app.company_return(p_signing uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s  public.company_signings;
  v_me uuid := app.current_user_id();
begin
  select * into v_s from public.company_signings s where s.id = p_signing for update;
  if v_s.id is null or v_me is null or not (
    app.has_role('company', array['admin'], v_s.unit_id)
    or app.has_role('company', array['platoon_commander'], (select p.unit_id from public.people p where p.id = v_s.to_person_id))
    or (v_s.from_person_id is not null and app.has_role('company', array['platoon_commander'], (select p.unit_id from public.people p where p.id = v_s.from_person_id)))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_s.returned_at is not null then
    raise exception 'the entry is already closed' using errcode = 'GD114';
  end if;
  update public.company_signings s set returned_at = now(), returned_by = v_me where s.id = v_s.id;
end
$$;
--> statement-breakpoint

-- ── אני and the roster now include the register ─────────────────────────────

-- Adds: company register entries the soldier got ('company'), and — on the soldier's own kesher
-- gear — who has it now while it is lent out (with_name).
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
      null::text
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
    select 'company'::text, coalesce(ki.name, ci.name), coalesce(ks.serial, ci.serial), cs.quantity, cs.signed_at,
      case when fp.id is null then 'מהפלוגה' else 'מ' || fp.full_name end,
      null::text
    from public.company_signings cs
    left join public.kesher_serials ks on ks.id = cs.kesher_serial_id
    left join public.kesher_items ki on ki.id = ks.item_id
    left join public.company_items ci on ci.id = cs.company_item_id
    left join public.people fp on fp.id = cs.from_person_id
    where cs.to_person_id = p_person and cs.returned_at is null;
end
$$;
--> statement-breakpoint

create or replace function app.company_roster(p_unit uuid)
returns table (
  id uuid, full_name text, role_title text, phone text, unit_id uuid,
  status_name text, status_color text, gear integer, linked boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := app.unit_scope('company');
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if not app.has_module('company') then
    return;
  end if;
  return query
    select p.id, p.full_name, p.role_title, p.phone, p.unit_id, st.name, st.color,
      (
        (select count(*) from public.logistics_assignments a where a.person_id = p.id and a.returned_at is null)
        + (select count(*) from public.kesher_holders h where h.signer_person_id = p.id or h.holder_person_id = p.id)
        + (select count(*) from public.company_signings cs where cs.to_person_id = p.id and cs.returned_at is null)
      )::integer,
      exists (select 1 from public.app_users u where u.person_id = p.id and u.active and u.auth_user_id is not null)
    from public.people p
    left join public.doch1_rounds r on r.state = 'active'
    left join public.doch1_days d on d.round_id = r.id and d.person_id = p.id and d.day = v_today
    left join public.doch1_statuses st on st.id = d.status_id
    where p.active
      and p.unit_id in (select app.unit_subtree(p_unit))
      and (v_scope is null or p.unit_id = any (v_scope));
end
$$;
--> statement-breakpoint

-- ── Guard triggers ──────────────────────────────────────────────────────────

-- A company item sits on a company, and its quantity never drops below what is signed out.
create or replace function app.company_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select u.kind from public.units u where u.id = new.unit_id) is distinct from 'company' then
    raise exception 'an item belongs to a company' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.quantity < coalesce((
      select sum(s.quantity) from public.company_signings s where s.company_item_id = new.id and s.returned_at is null
    ), 0) then
    raise exception 'more of this item is signed out than the new quantity' using errcode = 'GD111';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger company_items_guard before insert or update on public.company_items for each row execute function app.company_items_guard();
--> statement-breakpoint

create trigger company_items_touch before update on public.company_items for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger company_signings_touch before update on public.company_signings for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger company_items_audit after insert or update or delete on public.company_items for each row execute function app.audit();
--> statement-breakpoint
create trigger company_signings_audit after insert or update or delete on public.company_signings for each row execute function app.audit();
--> statement-breakpoint

-- ── Function privileges ─────────────────────────────────────────────────────

revoke all on function app.company_member_units(), app.company_member(uuid), app.company_gear_now(uuid, uuid),
  app.company_register_items(uuid), app.company_register(uuid, boolean, integer), app.company_soldier_names(uuid),
  app.company_sign(text, uuid, uuid, integer), app.company_return(uuid), app.company_items_guard() from public;
--> statement-breakpoint
grant execute on function app.company_member_units(), app.company_member(uuid),
  app.company_register_items(uuid), app.company_register(uuid, boolean, integer), app.company_soldier_names(uuid),
  app.company_sign(text, uuid, uuid, integer), app.company_return(uuid) to authenticated;
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

create policy company_items_select on public.company_items for select to authenticated
  using ((select app.company_member_units()) is null or unit_id = any ((select app.company_member_units())::uuid[]));
--> statement-breakpoint
create policy company_items_insert on public.company_items for insert to authenticated
  with check (app.has_role('company', array['admin'], unit_id));
--> statement-breakpoint
create policy company_items_update on public.company_items for update to authenticated
  using (app.has_role('company', array['admin'], unit_id))
  with check (app.has_role('company', array['admin'], unit_id));
--> statement-breakpoint
create policy company_items_delete on public.company_items for delete to authenticated
  using (app.has_role('company', array['admin'], unit_id));
--> statement-breakpoint

create policy company_signings_select on public.company_signings for select to authenticated
  using (
    (select app.company_member_units()) is null
    or unit_id = any ((select app.company_member_units())::uuid[])
    or to_person_id = (select app.my_person_id())
    or from_person_id = (select app.my_person_id())
  );
