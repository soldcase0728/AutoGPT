-- Prevent authenticated callers from using security-definer safety helpers to
-- inspect captures outside their own account or organisation.

create or replace function capture_safety_ok(p_capture_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with authorized_capture as (
    select c.id, c.media_revision from captures c
     where c.id = p_capture_id and (
       auth.uid() is null
       or c.person_id = app_current_person_id()
       or (app_is_staff() and c.org_id = app_current_org_id()))
  ), latest as (
    select s.* from safety_screens s join authorized_capture c on c.id = s.capture_id
     where s.media_revision = c.media_revision
     order by s.created_at desc limit 1
  )
  select coalesce((select
    status = 'no_flags'
    or (status = 'flags_detected' and not exists (
      select 1 from safety_findings f where f.safety_screen_id = latest.id
       and f.resolution_status = 'unreviewed'))
    or (status = 'screening_failed' and exists (
      select 1 from safety_screen_overrides o where o.safety_screen_id = latest.id))
    from latest), false)
$$;

create or replace function capture_publication_blockers(p_capture_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_blockers jsonb := '[]'::jsonb; v_screen safety_screens;
        v_capture captures; v_participation participation_state; v_deactivated timestamptz;
begin
  select * into v_capture from captures where id = p_capture_id;
  if not found then
    return jsonb_build_array(jsonb_build_object('reason', 'capture_not_found'));
  end if;
  if auth.uid() is not null and not coalesce((
    v_capture.person_id = app_current_person_id()
    or (app_is_staff() and v_capture.org_id = app_current_org_id())
  ), false) then
    raise exception 'capture does not exist' using errcode = 'insufficient_privilege';
  end if;
  v_blockers := capture_consent_blockers(p_capture_id);
  select p.participation, p.deactivated_at into v_participation, v_deactivated
    from people p where p.id = v_capture.person_id;
  if v_participation is distinct from 'active' or v_deactivated is not null then
    v_blockers := v_blockers || jsonb_build_object('reason', 'account_restricted');
  end if;
  if v_capture.takedown_at is not null then
    v_blockers := v_blockers || jsonb_build_object('reason', 'capture_taken_down');
  end if;
  select s.* into v_screen from safety_screens s join captures c on c.id = s.capture_id
   where s.capture_id = p_capture_id and s.media_revision = c.media_revision
   order by s.created_at desc limit 1;
  if not found then
    return v_blockers || jsonb_build_object('reason', 'safety_not_started');
  end if;
  if not capture_safety_ok(p_capture_id) then
    v_blockers := v_blockers || jsonb_build_object(
      'reason', case v_screen.status
        when 'pending' then 'safety_pending'
        when 'processing' then 'safety_processing'
        when 'flags_detected' then 'safety_findings_unresolved'
        when 'screening_failed' then 'safety_screen_failed'
        else 'safety_unavailable' end,
      'screen_id', v_screen.id, 'safety_status', v_screen.status);
  end if;
  return v_blockers;
end;
$$;

create or replace function capture_ready_to_post(p_capture_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from captures c join people p on p.id = c.person_id
    where c.id = p_capture_id and c.state = 'approved' and c.takedown_at is null
      and p.deactivated_at is null and p.participation = 'active')
    and jsonb_array_length(capture_publication_blockers(p_capture_id)) = 0
$$;

revoke execute on function capture_safety_ok(uuid) from public, anon;
revoke execute on function capture_publication_blockers(uuid) from public, anon;
revoke execute on function capture_ready_to_post(uuid) from public, anon;
grant execute on function capture_safety_ok(uuid), capture_publication_blockers(uuid),
  capture_ready_to_post(uuid) to authenticated;
