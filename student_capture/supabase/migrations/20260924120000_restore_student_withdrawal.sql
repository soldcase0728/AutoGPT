-- 20260903090000_automated_safety_screening.sql replaced the capture state
-- trigger and, in doing so, dropped the student withdrawal transitions that
-- 20260902141048_submission_lifecycle_contract.sql introduced. withdraw_capture()
-- runs as the student, so every student "Withdraw" and "Request withdrawal" has
-- been refused since. This restores those transitions and keeps the resubmission
-- rule the safety migration added. Staff transitions are unchanged.

create or replace function enforce_capture_state_transitions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_person uuid := app_current_person_id();
begin
  if new.state = old.state then return new; end if;
  if v_person is null or app_is_staff() then return new; end if;

  -- Send an upload, or withdraw it before anyone has looked at it.
  if old.state = 'uploading' and new.state in ('submitted', 'withdrawn') then return new; end if;
  if old.state = 'submitted' and new.state = 'withdrawn' then return new; end if;
  -- Once a reviewer has it, withdrawal becomes a request the desk decides.
  if old.state in ('in_review', 'changes_requested', 'approved', 'published', 'rejected')
     and new.state = 'withdrawal_requested' then return new; end if;
  -- Start a reshoot as a new media revision.
  if old.state = 'changes_requested' and new.state = 'uploading'
     and old.person_id = v_person and new.media_revision = old.media_revision + 1 then
    return new;
  end if;

  raise exception 'student capture transition % -> % is not allowed', old.state, new.state
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function enforce_capture_state_transitions() from public, anon, authenticated;
