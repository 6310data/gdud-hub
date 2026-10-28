-- "השלמת תאריך גיוס" (0022's release) gave soldiers without a call-up date the first day they had
-- ANY status, and the import ran the same rule — "0" (לא בשמ"פ) included, so most got the round's
-- first day. The rule is now the first day whose status counts in the סד״כ. Put that date on every
-- member whose call-up date the old rule wrote and nobody changed since: the audit log holds the
-- write (null → that day), and the date must still be the soldier's first day of any status while
-- not a day in the סד״כ. No such day → back to null, as before. A release date before the new
-- date leaves the soldier on null (doch1_members_service_dates).
with filled as (
  select distinct on (a.after ->> 'round_id', a.after ->> 'person_id')
         (a.after ->> 'round_id')::uuid as round_id,
         (a.after ->> 'person_id')::uuid as person_id,
         (a.after ->> 'call_up_on')::date as written
    from public.audit_log a
   where a.table_name = 'doch1_members' and a.action = 'update'
     and a.at >= timestamptz '2026-10-27 15:00+00'
     and a.before ->> 'call_up_on' is null
     and a.after ->> 'call_up_on' is not null
   order by a.after ->> 'round_id', a.after ->> 'person_id', a.at desc
),
firsts as (
  select d.round_id, d.person_id,
         min(d.day) as first_any,
         min(d.day) filter (where s.counts_in_sadak) as first_in
    from public.doch1_days d
    join public.doch1_statuses s on s.id = d.status_id
   group by d.round_id, d.person_id
)
update public.doch1_members m
   set call_up_on = case when m.released_on is null or m.released_on >= f.first_in then f.first_in end
  from filled w
  join firsts f on f.round_id = w.round_id and f.person_id = w.person_id
 where m.round_id = w.round_id
   and m.person_id = w.person_id
   and m.call_up_on = w.written
   and w.written = f.first_any
   and w.written is distinct from f.first_in;
