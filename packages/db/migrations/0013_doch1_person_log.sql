-- ════════════════════════════════════════════════════════════════════════════
-- The soldier card's change log (יומן שינויים): who changed a soldier's days, round fields
-- and personal details, and when. audit_log stays readable by core admins only (0001); this
-- function hands a doch1 user the audit rows of ONE soldier they already see, nothing else:
--   doch1_days / doch1_members rows of that soldier in that round, and their people row.
-- The rows hold only fields the caller can already read on those tables.
-- Tested in packages/db/test/rls.test.ts ("doch1" → change log).
-- ════════════════════════════════════════════════════════════════════════════

-- doch1 rows carry no `id`, so audit_log.row_id is null for them: find them by person_id.
create index audit_log_doch1_person_idx on public.audit_log ((coalesce(after, before) ->> 'person_id'), at)
  where table_name in ('doch1_days', 'doch1_members');
--> statement-breakpoint

create or replace function app.doch1_person_log(p_round uuid, p_person uuid, p_limit integer default 50)
returns table (at timestamptz, actor text, table_name text, action text, before jsonb, after jsonb)
language sql stable security definer set search_path = '' as $$
  select a.at, coalesce(u.display_name, u.email), a.table_name, a.action, a.before, a.after
  from public.audit_log a
  left join public.app_users u on u.id = a.actor_user_id
  where p_person in (select app.people_in_scope('doch1'))
    and (
      (
        a.table_name in ('doch1_days', 'doch1_members')
        and coalesce(a.after, a.before) ->> 'person_id' = p_person::text
        and coalesce(a.after, a.before) ->> 'round_id' = p_round::text
      )
      or (a.table_name = 'people' and a.row_id = p_person::text)
    )
  order by a.at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
--> statement-breakpoint
revoke all on function app.doch1_person_log(uuid, uuid, integer) from public;
--> statement-breakpoint
grant execute on function app.doch1_person_log(uuid, uuid, integer) to authenticated;
