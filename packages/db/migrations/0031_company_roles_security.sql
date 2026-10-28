-- ════════════════════════════════════════════════════════════════════════════
-- ניהול פלוגה, phase 3: roles from הגדרות, and previous names for the imports.
-- Rules: docs/SECURITY.md. Tested in packages/db/test/rls.test.ts ("company" → "roles").
-- Spec: docs/superpowers/specs/2026-10-28-company-design.md ("Granting department roles").
--
-- A company admin grants and revokes, on their own company or its platoons, to users whose linked
-- soldier is an active soldier of that company, only:
--   company    platoon_commander                          a platoon
--   doch1      company_user, viewer                       the company
--              platoon_commander                          a platoon
--   logistics  company_user                               the company
--   kesher     user                                       the company
-- Never admin / master_admin. Writes go only through app.company_grant_role / company_revoke_role
-- (SECURITY DEFINER); the memberships policies are not widened. A membership they create is marked
-- via_company; only those are revoked there — roles given in /admin or by a department's master admin
-- show read-only.
--
-- Error codes (apps/web/src/lib/company/errors.ts):
--   GD115 that role / unit isn't one a company admin gives
--   GD116 the user isn't linked to an active soldier of this company
--   GD117 the user already holds a role there, given by the department or in /admin
-- ════════════════════════════════════════════════════════════════════════════

-- via_company is set only by app.company_grant_role; any other insert gets false, and a change of
-- role or unit by someone else (/admin, a master admin) makes it theirs.
create or replace function app.memberships_via_company() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.company_grant', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.via_company := false;
    elsif (new.role, new.unit_id) is distinct from (old.role, old.unit_id) then
      new.via_company := false;
    else
      new.via_company := old.via_company;
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger memberships_via_company before insert or update on public.memberships
  for each row execute function app.memberships_via_company();
--> statement-breakpoint

-- Is this (module, role, unit) one a company admin of p_company may give?
create or replace function app.company_role_allowed(p_company uuid, p_module public.module_id, p_role text, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_company is not null and p_unit is not null and app.company_of(p_unit) = p_company and (
    case (select u.kind from public.units u where u.id = p_unit)
      when 'company' then
        (p_module = 'doch1' and p_role in ('company_user', 'viewer'))
        or (p_module = 'logistics' and p_role = 'company_user')
        or (p_module = 'kesher' and p_role = 'user')
      when 'platoon' then
        (p_module = 'doch1' and p_role = 'platoon_commander')
        or (p_module = 'company' and p_role = 'platoon_commander')
      else false
    end
  )
$$;
--> statement-breakpoint

-- Grant a whitelisted role. Re-granting on the same unit changes the role of a membership given here.
create or replace function app.company_grant_role(p_user uuid, p_module public.module_id, p_role text, p_unit uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_company uuid := app.company_of(p_unit);
  v_existing public.memberships;
  v_id uuid;
begin
  if v_company is null or not app.has_role('company', array['admin'], v_company) or p_user = app.current_user_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not app.company_role_allowed(v_company, p_module, p_role, p_unit) then
    raise exception 'a company admin does not give this role here' using errcode = 'GD115';
  end if;
  if not exists (
    select 1 from public.app_users u join public.people p on p.id = u.person_id
    where u.id = p_user and u.active and p.active and app.company_of(p.unit_id) = v_company
  ) then
    raise exception 'the user is not linked to an active soldier of this company' using errcode = 'GD116';
  end if;

  select * into v_existing from public.memberships m
  where m.user_id = p_user and m.module = p_module and m.unit_id = p_unit
  for update;
  if v_existing.id is not null and not v_existing.via_company then
    raise exception 'the user already holds a role there' using errcode = 'GD117';
  end if;

  perform set_config('app.company_grant', 'on', true);
  if v_existing.id is not null then
    update public.memberships m set role = p_role, via_company = true where m.id = v_existing.id returning m.id into v_id;
  else
    insert into public.memberships (user_id, module, role, unit_id, via_company)
    values (p_user, p_module, p_role, p_unit, true)
    returning id into v_id;
  end if;
  perform set_config('app.company_grant', '', true);
  return v_id;
end
$$;
--> statement-breakpoint

-- Revoke a membership given in ניהול פלוגה, by a company admin of its company.
create or replace function app.company_revoke_role(p_membership uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships m where m.id = p_membership for update;
  if v_m.id is null or not v_m.via_company or v_m.unit_id is null
    or not app.has_role('company', array['admin'], app.company_of(v_m.unit_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.memberships m where m.id = v_m.id;
end
$$;
--> statement-breakpoint

-- הגדרות → הרשאות, for a company admin: the accounts linked to the company's active soldiers, with
-- every role they hold in ניהול פלוגה, דוח 1, לוגיסטיקה and קשר (one row per role; one row with no
-- role for an account that has none). `editable` = given here and still revocable.
create or replace function app.company_access_list(p_unit uuid)
returns table (
  user_id uuid, email text, person_id uuid, full_name text, person_unit_id uuid,
  membership_id uuid, module public.module_id, role text, unit_id uuid, editable boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.company_of(p_unit) is distinct from p_unit or not app.has_role('company', array['admin'], p_unit) then
    return;
  end if;
  return query
    select u.id, u.email, p.id, p.full_name, p.unit_id, m.id, m.module, m.role, m.unit_id,
      coalesce(m.via_company and m.unit_id in (select app.unit_subtree(p_unit)), false)
    from public.app_users u
    join public.people p on p.id = u.person_id
    left join public.memberships m on m.user_id = u.id and m.module in ('company', 'doch1', 'logistics', 'kesher')
    where u.active and p.active and p.unit_id in (select app.unit_subtree(p_unit));
end
$$;
--> statement-breakpoint

revoke all on function app.memberships_via_company(), app.company_role_allowed(uuid, public.module_id, text, uuid),
  app.company_grant_role(uuid, public.module_id, text, uuid), app.company_revoke_role(uuid), app.company_access_list(uuid) from public;
--> statement-breakpoint
grant execute on function app.company_role_allowed(uuid, public.module_id, text, uuid),
  app.company_grant_role(uuid, public.module_id, text, uuid), app.company_revoke_role(uuid), app.company_access_list(uuid) to authenticated;
--> statement-breakpoint

-- ── Previous names for the imports ──────────────────────────────────────────

-- An approved name change is the soldier's name history: anyone who sees the soldier (any module,
-- as people_select) reads it, so the kesher and logistics imports can match the previous name. The
-- old name was already visible to them on the soldier's row before the change.
alter policy company_profile_requests_select on public.company_profile_requests
  using (
    person_id = (select app.my_person_id())
    or (select app.unit_scope('company', array['admin', 'platoon_commander'])) is null
    or unit_id = any ((select app.unit_scope('company', array['admin', 'platoon_commander']))::uuid[])
    or (
      field = 'full_name' and status = 'approved'
      and ((select app.unit_scope()) is null or unit_id = any ((select app.unit_scope())::uuid[]))
    )
  );
