-- people_in_scope() (0010) joined unit_scope() as a FROM subquery, which Postgres inlined into
-- the people scan — so unit_scope() ran once per soldier (~150 ms for 650 people).
-- Compute the scope once into a variable, then scan. Same result.
create or replace function app.people_in_scope(p_module public.module_id, p_roles text[] default null)
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := app.unit_scope(p_module, p_roles);
begin
  return query
    select p.id from public.people p where v_scope is null or p.unit_id = any (v_scope);
end
$$;
