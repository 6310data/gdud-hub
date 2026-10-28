-- ════════════════════════════════════════════════════════════════════════════
-- ניהול פלוגה, phase 1: joining, אני and self-edit.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("company").
-- Spec: docs/superpowers/specs/2026-10-28-company-design.md ("Security: functions and policies").
--
-- Two kinds of access:
--   linked soldier   app_users.person_id, set only by app.approve_join; app.my_person_id() is it
--                    (null when unlinked or the soldier is inactive). No membership: it covers
--                    the soldier's own rows only, read through the SECURITY DEFINER functions below.
--   company members  memberships on 'company': admin (a company, or the battalion) and
--                    platoon_commander (a platoon). They see the soldiers they cover.
--
-- The departments' tables (logistics, kesher, דוח 1) get no new policy: אני and the roster read
-- them through app.person_gear / app.person_days / app.company_roster, which return only rows of a
-- soldier the caller may see (themselves, or one in unit_scope('company')).
--
-- Written only through functions:
--   people.phone                       app.update_my_phone            (the soldier)
--   people.full_name / role_title      app.decide_profile_change      (company admin / platoon commander)
--   app_users.person_id (+ the row)    app.approve_join, app.company_link_account (company admin)
--   company_join_requests              app.request_join / approve_join
--   company_profile_requests           app.request_profile_change / decide_profile_change
--
-- Error codes the app turns into messages (apps/web/src/lib/company/errors.ts):
--   GD101 too many join attempts today    GD102 join input not in the right format
--   GD103 request already decided         GD104 the soldier is no longer active
--   GD105 soldier linked to another account  GD106 the account was disabled
--   GD107 phone not in the right format   GD108 name / תפקיד not in the right format
--   GD109 email not in the right format
-- ════════════════════════════════════════════════════════════════════════════

-- The module's old 'user' role is gone (now platoon_commander, on a platoon). The module was a
-- placeholder page, so those memberships gave nothing; they are removed rather than guessed at.
delete from public.memberships where module = 'company' and role not in ('admin', 'platoon_commander');
--> statement-breakpoint

-- ── Privileges ──────────────────────────────────────────────────────────────

grant select on public.company_join_requests, public.company_profile_requests to authenticated;
--> statement-breakpoint
-- company_join_attempts: no grant at all (app.request_join only)

-- ── Helper functions ────────────────────────────────────────────────────────

-- The current user's linked soldier, if the account and the soldier are both active.
create or replace function app.my_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
  from public.app_users u
  join public.people p on p.id = u.person_id
  where u.auth_user_id = auth.uid() and u.active and p.active
$$;
--> statement-breakpoint

-- The company (unit of kind company) a unit belongs to, or null.
create or replace function app.company_of(p_unit uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.units u
  where u.id in (select app.unit_lineage(p_unit)) and u.kind = 'company'
  limit 1
$$;
--> statement-breakpoint

-- The unit and everything below it.
create or replace function app.unit_subtree(p_unit uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive down(id, depth) as (
    select u.id, 0 from public.units u where u.id = p_unit
    union all
    select u.id, down.depth + 1 from public.units u join down on u.parent_id = down.id where down.depth < 16
  )
  select id from down
$$;
--> statement-breakpoint

-- May the current user see this soldier's אני view? The soldier themselves, or a company member
-- covering the soldier's unit.
create or replace function app.company_sees_person(p_person uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[];
begin
  if p_person is null then
    return false;
  end if;
  if p_person = app.my_person_id() then
    return true;
  end if;
  v_scope := app.unit_scope('company');
  return exists (
    select 1 from public.people p where p.id = p_person and (v_scope is null or p.unit_id = any (v_scope))
  );
end
$$;
--> statement-breakpoint

-- ── Reads for אני (and a commander's view of one soldier) ──────────────────

-- The soldier's own details, and whether an active account is linked to them. Never the personal number.
create or replace function app.person_details(p_person uuid)
returns table (id uuid, full_name text, role_title text, phone text, unit_id uuid, active boolean, linked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_sees_person(p_person) then
    return;
  end if;
  return query
    select p.id, p.full_name, p.role_title, p.phone, p.unit_id, p.active,
      exists (select 1 from public.app_users u where u.person_id = p.id and u.active)
    from public.people p where p.id = p_person;
end
$$;
--> statement-breakpoint

-- Everything signed on the soldier: logistics (open assignments; אפסון marked), אפסון without an open
-- assignment, kesher (signer or holder inside the company). `with_name` is filled by the company
-- register (phase 2): who has the gear now.
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
      null::text
    from public.kesher_holders h
    join public.kesher_serials s on s.id = h.serial_id
    join public.kesher_items i on i.id = s.item_id
    where h.signer_person_id = p_person or h.holder_person_id = p_person;
end
$$;
--> statement-breakpoint

-- The soldier's days in the active round, with the flags each day's status had (statuses are
-- versioned, so a past day keeps its flags). One row with day null when the soldier has no day in
-- an active round; no rows when no round is active.
create or replace function app.person_days(p_person uuid)
returns table (
  round_name text, starts_on date, ends_on date,
  day date, status_name text, color text, present boolean, home boolean, org boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.company_sees_person(p_person) then
    return;
  end if;
  return query
    select r.name, r.starts_on, r.ends_on, d.day, st.name, st.color, st.counts_as_present, st.home_day, st.org_day
    from public.doch1_rounds r
    left join public.doch1_days d on d.round_id = r.id and d.person_id = p_person
    left join public.doch1_statuses st on st.id = d.status_id
    where r.state = 'active'
    order by d.day;
end
$$;
--> statement-breakpoint

create or replace function app.my_gear()
returns table (source text, item text, serial text, qty integer, since timestamptz, detail text, with_name text)
language sql stable security definer set search_path = '' as $$
  select * from app.person_gear(app.my_person_id())
$$;
--> statement-breakpoint

create or replace function app.my_days()
returns table (
  round_name text, starts_on date, ends_on date,
  day date, status_name text, color text, present boolean, home boolean, org boolean
)
language sql stable security definer set search_path = '' as $$
  select * from app.person_days(app.my_person_id())
$$;
--> statement-breakpoint

-- The roster (הפלוגה) of a unit for a company member: the active soldiers below p_unit that the
-- caller covers in this module, with today's status, how many items are signed on them and
-- whether their account is linked. No personal number.
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

-- ── Joining ─────────────────────────────────────────────────────────────────

-- A signed-in Google account (verified email) without a linked soldier asks to be linked. Matches an
-- active soldier by personal number + the last 4 digits of their phone and, on a match, opens a
-- request for that soldier's company admins. ALWAYS returns nothing, match or not, and a request that
-- matched nothing leaves no row (only the attempt is counted). An account that is disabled or already
-- linked gets the same silence. At most 5 attempts per account in 24 hours.
create or replace function app.request_join(p_personal_number text, p_phone_last4 text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claims   jsonb   := auth.jwt();
  v_uid      uuid    := auth.uid();
  v_email    text    := lower(v_claims ->> 'email');
  v_provider text    := v_claims -> 'app_metadata' ->> 'provider';
  v_verified boolean := coalesce((v_claims -> 'user_metadata' ->> 'email_verified')::boolean, false);
  v_name     text    := left(coalesce(v_claims -> 'user_metadata' ->> 'full_name', v_claims -> 'user_metadata' ->> 'name'), 120);
  v_pn       text    := ltrim(regexp_replace(coalesce(p_personal_number, ''), '\D', '', 'g'), '0');
  v_last4    text    := regexp_replace(coalesce(p_phone_last4, ''), '\D', '', 'g');
  v_person   uuid;
begin
  if v_uid is null or v_email is null or v_provider is distinct from 'google' or not v_verified then
    raise exception 'sign in with a verified Google account' using errcode = '42501';
  end if;
  if length(v_pn) not between 5 and 12 or length(v_last4) <> 4 then
    raise exception 'personal number or phone digits not in the right format' using errcode = 'GD102';
  end if;

  -- one attempt at a time per account, so the limit can't be raced
  perform pg_advisory_xact_lock(hashtextextended('company_join:' || v_uid::text, 0));
  if (select count(*) from public.company_join_attempts a where a.auth_user_id = v_uid and a.at > now() - interval '1 day') >= 5 then
    raise exception 'too many join attempts' using errcode = 'GD101';
  end if;
  insert into public.company_join_attempts (auth_user_id) values (v_uid);

  if exists (
    select 1 from public.app_users u
    where (u.auth_user_id = v_uid or u.email = v_email) and (not u.active or u.person_id is not null)
  ) then
    return;
  end if;

  select p.id into v_person
  from public.people p
  where p.active
    and p.personal_number is not null
    and ltrim(regexp_replace(p.personal_number, '\D', '', 'g'), '0') = v_pn
    and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 4) = v_last4
  limit 1;
  if v_person is null then
    return;
  end if;

  -- one open request per account: a new match replaces the soldier of the open one
  update public.company_join_requests r
     set person_id = v_person,
         email = v_email,
         display_name = v_name,
         notified_at = case when r.person_id = v_person then r.notified_at end
   where r.auth_user_id = v_uid and r.status = 'pending';
  if not found then
    insert into public.company_join_requests (auth_user_id, email, display_name, person_id, unit_id)
    values (v_uid, v_email, v_name, v_person, (select p.unit_id from public.people p where p.id = v_person));
  end if;
end
$$;
--> statement-breakpoint

-- A company admin of the soldier's unit approves (links the account to the soldier, creating its
-- app_users row if needed) or rejects a join request. Never for one's own account; never over an
-- account a core admin disabled; never a second active account for the same soldier.
create or replace function app.approve_join(p_request uuid, p_approve boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req  public.company_join_requests;
  v_user public.app_users;
  v_me   uuid := app.current_user_id();
  v_unit uuid;
begin
  select * into v_req from public.company_join_requests r where r.id = p_request for update;
  v_unit := (select p.unit_id from public.people p where p.id = v_req.person_id);
  if v_req.id is null or not app.has_role('company', array['admin'], v_unit)
    or (v_req.auth_user_id = auth.uid() and not app.is_super_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request already decided' using errcode = 'GD103';
  end if;

  if not p_approve then
    update public.company_join_requests r set status = 'rejected', decided_by = v_me, decided_at = now() where r.id = v_req.id;
    return;
  end if;

  if not exists (select 1 from public.people p where p.id = v_req.person_id and p.active) then
    raise exception 'the soldier is no longer active' using errcode = 'GD104';
  end if;
  if exists (
    select 1 from public.app_users u
    where u.person_id = v_req.person_id and u.active and u.auth_user_id is distinct from v_req.auth_user_id
  ) then
    raise exception 'the soldier is linked to another account' using errcode = 'GD105';
  end if;

  select * into v_user from public.app_users u where u.auth_user_id = v_req.auth_user_id;
  if v_user.id is null then
    select * into v_user from public.app_users u where u.email = v_req.email;
  end if;
  if v_user.id is not null then
    if not v_user.active or (v_user.auth_user_id is not null and v_user.auth_user_id <> v_req.auth_user_id) then
      raise exception 'the account was disabled' using errcode = 'GD106';
    end if;
    update public.app_users u set person_id = v_req.person_id, auth_user_id = v_req.auth_user_id where u.id = v_user.id;
  else
    insert into public.app_users (email, auth_user_id, display_name, person_id)
    values (v_req.email, v_req.auth_user_id, (select p.full_name from public.people p where p.id = v_req.person_id), v_req.person_id);
  end if;

  update public.company_join_requests r set status = 'approved', decided_by = v_me, decided_at = now() where r.id = v_req.id;
  -- other accounts asking for the same soldier can't be approved any more
  update public.company_join_requests r
     set status = 'cancelled', decided_by = v_me, decided_at = now()
   where r.person_id = v_req.person_id and r.status = 'pending';
end
$$;
--> statement-breakpoint

-- A company admin links a soldier to a Google email by hand (the soldier who couldn't join on their
-- own): the email becomes an invite tied to the soldier, claimed on sign-in by app.link_auth_user().
-- An existing account only if it is active and not linked to a soldier yet.
create or replace function app.company_link_account(p_person uuid, p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  public.app_users;
begin
  if not app.has_role('company', array['admin'], (select p.unit_id from public.people p where p.id = p_person)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 320 then
    raise exception 'email not in the right format' using errcode = 'GD109';
  end if;
  if not exists (select 1 from public.people p where p.id = p_person and p.active) then
    raise exception 'the soldier is no longer active' using errcode = 'GD104';
  end if;
  if exists (select 1 from public.app_users u where u.person_id = p_person and u.active) then
    raise exception 'the soldier is linked to another account' using errcode = 'GD105';
  end if;
  select * into v_user from public.app_users u where u.email = v_email;
  if v_user.id is null then
    insert into public.app_users (email, display_name, person_id)
    values (v_email, (select p.full_name from public.people p where p.id = p_person), p_person);
  elsif not v_user.active or v_user.person_id is not null then
    raise exception 'the account was disabled or is linked to another soldier' using errcode = 'GD106';
  else
    update public.app_users u set person_id = p_person where u.id = v_user.id;
  end if;
  -- open join requests for this soldier are settled by the link
  update public.company_join_requests r
     set status = 'cancelled', decided_by = app.current_user_id(), decided_at = now()
   where r.person_id = p_person and r.status = 'pending';
end
$$;
--> statement-breakpoint

-- ── Self-edit ───────────────────────────────────────────────────────────────

-- The soldier's own phone, at once (audited by people_audit). Stored as digits, starting with 0.
create or replace function app.update_my_phone(p_phone text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_person uuid := app.my_person_id();
  v_d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_person is null then
    raise exception 'no linked soldier' using errcode = '42501';
  end if;
  if v_d like '972%' then
    v_d := '0' || substr(v_d, 4);
  end if;
  if v_d !~ '^0[0-9]{8,9}$' then
    raise exception 'phone not in the right format' using errcode = 'GD107';
  end if;
  update public.people p set phone = v_d where p.id = v_person;
  return v_d;
end
$$;
--> statement-breakpoint

-- The soldier proposes a new name or תפקיד. Replaces their open request for that field; proposing the
-- current value withdraws it. Returns the request id (null when withdrawn).
create or replace function app.request_profile_change(p_field text, p_value text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_person uuid := app.my_person_id();
  v_value  text := nullif(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '');
  v_old    text;
  v_id     uuid;
begin
  if v_person is null then
    raise exception 'no linked soldier' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('full_name', 'role_title') then
    raise exception 'unknown field' using errcode = '22023';
  end if;
  if (p_field = 'full_name' and (v_value is null or length(v_value) not between 2 and 60))
    or (p_field = 'role_title' and coalesce(length(v_value), 0) > 40) then
    raise exception 'value not in the right format' using errcode = 'GD108';
  end if;

  select case p_field when 'full_name' then p.full_name else p.role_title end into v_old
  from public.people p where p.id = v_person;

  if v_value is not distinct from v_old then
    update public.company_profile_requests r
       set status = 'cancelled', decided_by = app.current_user_id(), decided_at = now()
     where r.person_id = v_person and r.field = p_field and r.status = 'pending';
    return null;
  end if;

  update public.company_profile_requests r
     set new_value = v_value, old_value = v_old, requested_by = app.current_user_id(), notified_at = null
   where r.person_id = v_person and r.field = p_field and r.status = 'pending'
  returning r.id into v_id;
  if v_id is null then
    insert into public.company_profile_requests (person_id, unit_id, field, old_value, new_value, requested_by)
    values (v_person, (select p.unit_id from public.people p where p.id = v_person), p_field, v_old, v_value, app.current_user_id())
    returning id into v_id;
  end if;
  return v_id;
end
$$;
--> statement-breakpoint

-- A company admin, or the platoon commander of the soldier's platoon, decides a change request.
-- Approving writes people (audited) and keeps the value it replaced in old_value. Nobody decides
-- their own request.
create or replace function app.decide_profile_change(p_request uuid, p_approve boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.company_profile_requests;
  v_me  uuid := app.current_user_id();
  v_old text;
begin
  select * into v_req from public.company_profile_requests r where r.id = p_request for update;
  if v_req.id is null
    or not app.has_role('company', array['admin', 'platoon_commander'], (select p.unit_id from public.people p where p.id = v_req.person_id))
    or (v_req.person_id = app.my_person_id() and not app.is_super_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request already decided' using errcode = 'GD103';
  end if;

  if not p_approve then
    update public.company_profile_requests r set status = 'rejected', decided_by = v_me, decided_at = now() where r.id = v_req.id;
    return;
  end if;

  if v_req.field = 'full_name' then
    select p.full_name into v_old from public.people p where p.id = v_req.person_id;
    update public.people p set full_name = v_req.new_value where p.id = v_req.person_id;
  else
    select p.role_title into v_old from public.people p where p.id = v_req.person_id;
    update public.people p set role_title = v_req.new_value where p.id = v_req.person_id;
  end if;
  update public.company_profile_requests r
     set status = 'approved', old_value = v_old, decided_by = v_me, decided_at = now()
   where r.id = v_req.id;
end
$$;
--> statement-breakpoint

-- ── Triggers ────────────────────────────────────────────────────────────────

-- unit_id always follows the soldier (for RLS), whatever the writer sends.
create or replace function app.company_request_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.unit_id := (select p.unit_id from public.people p where p.id = new.person_id);
  return new;
end
$$;
--> statement-breakpoint
create trigger company_join_requests_unit before insert or update of person_id on public.company_join_requests
  for each row execute function app.company_request_unit();
--> statement-breakpoint
create trigger company_profile_requests_unit before insert or update of person_id on public.company_profile_requests
  for each row execute function app.company_request_unit();
--> statement-breakpoint

create trigger company_join_requests_touch before update on public.company_join_requests for each row execute function app.touch_updated_at();
--> statement-breakpoint
create trigger company_profile_requests_touch before update on public.company_profile_requests for each row execute function app.touch_updated_at();
--> statement-breakpoint

create trigger company_join_requests_audit after insert or update or delete on public.company_join_requests for each row execute function app.audit();
--> statement-breakpoint
create trigger company_join_attempts_audit after insert or update or delete on public.company_join_attempts for each row execute function app.audit();
--> statement-breakpoint
create trigger company_profile_requests_audit after insert or update or delete on public.company_profile_requests for each row execute function app.audit();
--> statement-breakpoint

-- ── Function privileges ─────────────────────────────────────────────────────

revoke all on function app.my_person_id(), app.company_of(uuid), app.unit_subtree(uuid), app.company_sees_person(uuid),
  app.person_details(uuid), app.person_gear(uuid), app.person_days(uuid), app.my_gear(), app.my_days(),
  app.company_roster(uuid), app.request_join(text, text), app.approve_join(uuid, boolean), app.company_link_account(uuid, text),
  app.update_my_phone(text), app.request_profile_change(text, text), app.decide_profile_change(uuid, boolean),
  app.company_request_unit() from public;
--> statement-breakpoint
grant execute on function app.my_person_id(), app.company_of(uuid), app.unit_subtree(uuid), app.company_sees_person(uuid),
  app.person_details(uuid), app.person_gear(uuid), app.person_days(uuid), app.my_gear(), app.my_days(),
  app.company_roster(uuid), app.request_join(text, text), app.approve_join(uuid, boolean), app.company_link_account(uuid, text),
  app.update_my_phone(text), app.request_profile_change(text, text), app.decide_profile_change(uuid, boolean)
  to authenticated;
--> statement-breakpoint

-- ── Policies ────────────────────────────────────────────────────────────────

-- join requests: the company admins covering the soldier's unit
create policy company_join_requests_select on public.company_join_requests for select to authenticated
  using (
    (select app.unit_scope('company', array['admin'])) is null
    or unit_id = any ((select app.unit_scope('company', array['admin']))::uuid[])
  );
--> statement-breakpoint

-- change requests: the soldier, and the company admins / platoon commanders covering them
create policy company_profile_requests_select on public.company_profile_requests for select to authenticated
  using (
    person_id = (select app.my_person_id())
    or (select app.unit_scope('company', array['admin', 'platoon_commander'])) is null
    or unit_id = any ((select app.unit_scope('company', array['admin', 'platoon_commander']))::uuid[])
  );
--> statement-breakpoint

-- push: a company member or a linked soldier may subscribe too (one subscription serves every module)
alter policy doch1_push_subscriptions_insert on public.doch1_push_subscriptions
  with check (
    user_id = (select app.current_user_id())
    and (
      (select app.has_module('doch1'))
      or (select app.has_module('kesher'))
      or (select app.has_module('company'))
      or (select app.my_person_id()) is not null
    )
  );
