-- ════════════════════════════════════════════════════════════════════════════
-- app.company_present_on(person, day) (0037) is security definer, has no access check and was granted
-- to authenticated: any signed-in user could ask whether any soldier was present (and not home) on a
-- day in דוח 1. Its only caller is the participants guard trigger (security definer, runs as the
-- owner), so nobody needs to call it directly — the grant goes. Members of the company see a soldier's
-- status through company_activity_candidates / company_activity_people, which check access first.
-- Tested in packages/db/test/rls.test.ts ("company" → "activities").
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function app.company_present_on(uuid, date) from authenticated;
