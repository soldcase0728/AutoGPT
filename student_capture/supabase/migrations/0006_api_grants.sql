-- Supabase stopped exposing newly-created public tables to the Data API by
-- default in 2026. Keep the app's authenticated API surface explicit and do
-- not expose student data or SECURITY DEFINER functions to anonymous callers.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon, authenticated;

-- Helpers used by RLS policies and the small set of RPCs used by the app.
grant execute on function app_current_person_id() to authenticated;
grant execute on function app_current_org_id() to authenticated;
grant execute on function app_current_person_role() to authenticated;
grant execute on function app_is_staff() to authenticated;
grant execute on function app_is_admin() to authenticated;
grant execute on function app_is_active_participant() to authenticated;
grant execute on function capture_consent_blockers(uuid) to authenticated;
grant execute on function has_current_release(uuid, text) to authenticated;
grant execute on function take_down_capture(uuid, text) to authenticated;

-- The captures bucket remains private; these grants only let its RLS policies
-- decide whether an authenticated request may insert or read an object.
grant select, insert on storage.objects to authenticated;
