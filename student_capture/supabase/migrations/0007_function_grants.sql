-- Hosted projects may add role-specific function grants while migrations are
-- running. Reassert the intended RPC surface after every function exists.

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function app_current_person_id() to authenticated;
grant execute on function app_current_org_id() to authenticated;
grant execute on function app_current_person_role() to authenticated;
grant execute on function app_is_staff() to authenticated;
grant execute on function app_is_admin() to authenticated;
grant execute on function app_is_active_participant() to authenticated;
grant execute on function capture_consent_blockers(uuid) to authenticated;
grant execute on function has_current_release(uuid, text) to authenticated;
grant execute on function take_down_capture(uuid, text) to authenticated;
