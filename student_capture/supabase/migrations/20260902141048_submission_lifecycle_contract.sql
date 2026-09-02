-- Submission lifecycle foundation.
--
-- `captures` remains the canonical submission envelope. These fields and RPCs
-- extend that model; they do not introduce a second status or upload system.

alter table captures
  add column client_submission_id uuid,
  add column state_changed_at timestamptz not null default now(),
  add column review_started_at timestamptz,
  add column review_started_by uuid references people (id) on delete set null,
  add column withdrawn_at timestamptz,
  add column retention_due_at timestamptz,
  add column media_deleted_at timestamptz;

alter table submission_media
  add column client_media_id uuid;

create unique index captures_person_client_submission_key
  on captures (person_id, client_submission_id)
  where client_submission_id is not null;

create unique index submission_media_client_key
  on submission_media (submission_id, client_media_id)
  where client_media_id is not null;

create index captures_retention_due_idx
  on captures (retention_due_at)
  where retention_due_at is not null and media_deleted_at is null;

create type withdrawal_decision as enum ('approved', 'denied');

create table capture_withdrawal_requests (
  id              uuid primary key default gen_random_uuid(),
  capture_id      uuid not null references captures (id) on delete cascade,
  org_id          uuid not null references organizations (id) on delete cascade,
  requested_by    uuid not null references people (id) on delete restrict,
  reason          text,
  previous_state  capture_state not null,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references people (id) on delete set null,
  decision        withdrawal_decision,
  decision_reason text,
  check ((decision is null and decided_at is null and decided_by is null)
         or (decision is not null and decided_at is not null and decided_by is not null))
);

create unique index capture_withdrawal_one_pending
  on capture_withdrawal_requests (capture_id)
  where decision is null;
create index capture_withdrawal_org_pending_idx
  on capture_withdrawal_requests (org_id, requested_at)
  where decision is null;

alter table capture_withdrawal_requests enable row level security;

create policy withdrawal_requests_read on capture_withdrawal_requests for select
  to authenticated
  using (
    requested_by = (select app_current_person_id())
    or ((select app_is_staff()) and org_id = (select app_current_org_id()))
  );

-- Writes go through the atomic RPCs below. The table itself is read-only over
-- the Data API so a caller cannot forge a decision or its audit history.
grant select on capture_withdrawal_requests to authenticated;
revoke insert, update, delete on capture_withdrawal_requests from authenticated;
revoke all on capture_withdrawal_requests from anon;

-- Every state change records its timestamp and applies one shared retention
-- rule to rejected and withdrawn media.
create or replace function stamp_capture_lifecycle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state is distinct from old.state then
    new.state_changed_at := now();
  end if;

  if new.state in ('rejected', 'withdrawn')
     and old.state is distinct from new.state then
    new.retention_due_at := now() + interval '30 days';
  elsif old.state in ('rejected', 'withdrawn')
        and new.state not in ('rejected', 'withdrawn') then
    new.retention_due_at := null;
    new.media_deleted_at := null;
  end if;
  return new;
end;
$$;

create trigger captures_lifecycle_stamp
  before update on captures
  for each row execute function stamp_capture_lifecycle();

-- Legal transitions are enforced independent of the UI. Trusted database
-- triggers can still execute state changes when there is no signed-in actor.
create or replace function enforce_capture_state_transitions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_person uuid := app_current_person_id();
  v_staff boolean := app_is_staff();
  v_legal boolean := false;
begin
  if new.state = old.state or v_person is null then
    return new;
  end if;

  v_legal := case old.state
    when 'uploading' then new.state in ('submitted', 'withdrawn')
    when 'submitted' then new.state in ('in_review', 'withdrawn')
    when 'in_review' then new.state in (
      'approved', 'changes_requested', 'rejected', 'withdrawal_requested')
    when 'changes_requested' then new.state in (
      'submitted', 'approved', 'rejected', 'withdrawal_requested')
    when 'approved' then new.state in ('published', 'rejected', 'withdrawal_requested')
    when 'published' then new.state in ('rejected', 'withdrawal_requested')
    when 'rejected' then new.state = 'withdrawal_requested'
    when 'withdrawal_requested' then new.state in (
      'withdrawn', 'in_review', 'changes_requested', 'approved', 'published', 'rejected')
    else false
  end;

  if not v_legal then
    raise exception 'illegal capture transition % -> %', old.state, new.state
      using errcode = 'check_violation';
  end if;

  if not v_staff and not (
    (old.state = 'uploading' and new.state in ('submitted', 'withdrawn'))
    or (old.state = 'submitted' and new.state = 'withdrawn')
    or (old.state in ('in_review', 'changes_requested', 'approved', 'published', 'rejected')
        and new.state = 'withdrawal_requested')
  ) then
    raise exception 'students cannot perform capture transition % -> %', old.state, new.state
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Revocation applies to every mutation in the upload path, including an
-- envelope that was reserved before the student's account was revoked.
drop policy if exists captures_update_own_while_uploading on captures;
create policy captures_update_own_while_uploading on captures for update
  to authenticated
  using (person_id = (select app_current_person_id())
         and state = 'uploading'
         and (select app_is_active_participant()))
  with check (person_id = (select app_current_person_id())
              and (select app_is_active_participant())
              and state in ('uploading', 'submitted'));

drop policy if exists submission_media_insert_own on submission_media;
create policy submission_media_insert_own on submission_media for insert
  to authenticated
  with check ((select app_is_active_participant()) and exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = (select app_current_person_id())
       and c.state = 'uploading'));

drop policy if exists submission_media_update_own on submission_media;
create policy submission_media_update_own on submission_media for update
  to authenticated
  using ((select app_is_active_participant()) and exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = (select app_current_person_id())
       and c.state = 'uploading'))
  with check ((select app_is_active_participant()) and exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = (select app_current_person_id())
       and c.state = 'uploading'));

drop policy if exists submission_media_delete_own on submission_media;
create policy submission_media_delete_own on submission_media for delete
  to authenticated
  using ((select app_is_active_participant()) and exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = (select app_current_person_id())
       and c.state = 'uploading'));

drop policy if exists captures_student_insert on storage.objects;
create policy captures_student_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and (select app_is_active_participant())
    and (storage.foldername(name))[1] = (select app_current_person_id())::text
    and exists (
      select 1 from captures c
       where c.id::text = (storage.foldername(name))[2]
         and c.person_id = (select app_current_person_id())
         and c.state = 'uploading'));

create or replace function withdraw_capture(p_capture_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_capture captures;
  v_request_id uuid;
begin
  if v_actor is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;

  select * into v_capture from captures where id = p_capture_id for update;
  if not found then raise exception 'capture does not exist'; end if;
  if v_capture.person_id <> v_actor then
    raise exception 'capture is not yours' using errcode = 'insufficient_privilege';
  end if;

  if v_capture.state = 'withdrawn' then
    return jsonb_build_object('status', 'withdrawn');
  elsif v_capture.state = 'withdrawal_requested' then
    select id into v_request_id from capture_withdrawal_requests
     where capture_id = p_capture_id and decision is null;
    return jsonb_build_object('status', 'withdrawal_requested', 'request_id', v_request_id);
  elsif v_capture.state in ('uploading', 'submitted') then
    update captures
       set state = 'withdrawn', withdrawn_at = now()
     where id = p_capture_id;
    if v_capture.assignment_id is not null then
      update assignments set completed_at = null where id = v_capture.assignment_id;
    end if;
    insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
    values (v_capture.org_id, v_actor, 'capture.withdrawn', 'capture', p_capture_id,
            jsonb_build_object('from_state', v_capture.state, 'reason', nullif(trim(p_reason), '')));
    return jsonb_build_object('status', 'withdrawn');
  elsif v_capture.state in ('in_review', 'changes_requested', 'approved', 'published', 'rejected') then
    insert into capture_withdrawal_requests (
      capture_id, org_id, requested_by, reason, previous_state)
    values (
      p_capture_id, v_capture.org_id, v_actor, nullif(trim(p_reason), ''), v_capture.state)
    returning id into v_request_id;
    update captures set state = 'withdrawal_requested' where id = p_capture_id;
    insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
    values (v_capture.org_id, v_actor, 'capture.withdrawal_requested', 'capture', p_capture_id,
            jsonb_build_object('request_id', v_request_id, 'from_state', v_capture.state,
                               'reason', nullif(trim(p_reason), '')));
    return jsonb_build_object('status', 'withdrawal_requested', 'request_id', v_request_id);
  end if;

  raise exception 'capture cannot be withdrawn from state %', v_capture.state
    using errcode = 'check_violation';
end;
$$;

create or replace function open_capture_for_review(p_capture_id uuid)
returns capture_state language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_capture captures;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may open reviews'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_capture from captures where id = p_capture_id for update;
  if not found or v_capture.org_id <> app_current_org_id() then
    raise exception 'capture does not exist';
  end if;
  if v_capture.state = 'submitted' then
    update captures
       set state = 'in_review', review_started_at = now(), review_started_by = v_actor
     where id = p_capture_id;
    insert into reviews (capture_id, reviewer_id, state)
    values (p_capture_id, v_actor, 'in_review');
    insert into audit_log (org_id, actor_id, action, subject_type, subject_id)
    values (v_capture.org_id, v_actor, 'capture.review_started', 'capture', p_capture_id);
    return 'in_review';
  end if;
  return v_capture.state;
end;
$$;

create or replace function review_capture(
  p_capture_id uuid,
  p_decision capture_state,
  p_note text default null)
returns capture_state language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_capture captures;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may review captures'
      using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected', 'published') then
    raise exception 'invalid review decision' using errcode = 'check_violation';
  end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then
    raise exception 'changes need a note' using errcode = 'check_violation';
  end if;

  select * into v_capture from captures where id = p_capture_id for update;
  if not found or v_capture.org_id <> app_current_org_id() then
    raise exception 'capture does not exist';
  end if;
  if v_capture.state = 'withdrawal_requested' then
    raise exception 'resolve the withdrawal request before reviewing'
      using errcode = 'check_violation';
  end if;
  if v_capture.state = 'submitted' then
    raise exception 'open the capture before deciding it' using errcode = 'check_violation';
  end if;
  if not (
    (v_capture.state = 'in_review'
     and p_decision in ('approved', 'changes_requested', 'rejected'))
    or (v_capture.state = 'changes_requested'
        and p_decision in ('approved', 'rejected'))
    or (v_capture.state = 'approved' and p_decision = 'published')
  ) then
    raise exception 'decision % is not available from state %', p_decision, v_capture.state
      using errcode = 'check_violation';
  end if;

  update captures set state = p_decision where id = p_capture_id;
  insert into reviews (capture_id, reviewer_id, state, note)
  values (p_capture_id, v_actor, p_decision, nullif(trim(p_note), ''));
  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_capture.org_id, v_actor, 'capture.' || p_decision::text,
          'capture', p_capture_id, jsonb_build_object('note', nullif(trim(p_note), '')));
  return p_decision;
end;
$$;

create or replace function decide_capture_withdrawal(
  p_request_id uuid,
  p_decision withdrawal_decision,
  p_reason text default null)
returns capture_state language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_request capture_withdrawal_requests;
  v_state capture_state;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may decide withdrawal requests'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_request from capture_withdrawal_requests where id = p_request_id for update;
  if not found or v_request.org_id <> app_current_org_id() then
    raise exception 'withdrawal request does not exist';
  end if;
  if v_request.decision is not null then
    select state into v_state from captures where id = v_request.capture_id;
    return v_state;
  end if;

  if p_decision = 'approved' then
    v_state := 'withdrawn';
    update captures
       set state = v_state, withdrawn_at = now()
     where id = v_request.capture_id and state = 'withdrawal_requested';
    update assignments
       set completed_at = null
     where id = (select assignment_id from captures where id = v_request.capture_id);
  else
    v_state := v_request.previous_state;
    update captures
       set state = v_state
     where id = v_request.capture_id and state = 'withdrawal_requested';
  end if;
  if not found then raise exception 'capture is no longer awaiting withdrawal'; end if;

  update capture_withdrawal_requests
     set decision = p_decision, decision_reason = nullif(trim(p_reason), ''),
         decided_at = now(), decided_by = v_actor
   where id = p_request_id;
  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_request.org_id, v_actor, 'capture.withdrawal_' || p_decision::text,
          'capture', v_request.capture_id,
          jsonb_build_object('request_id', p_request_id, 'reason', nullif(trim(p_reason), ''),
                             'restored_state', case when p_decision = 'denied'
                                                   then v_request.previous_state else null end));
  return v_state;
end;
$$;

-- Newly-created functions are executable by PUBLIC unless revoked explicitly.
revoke execute on function stamp_capture_lifecycle() from public, anon, authenticated;
revoke execute on function enforce_capture_state_transitions() from public, anon, authenticated;
revoke execute on function withdraw_capture(uuid, text) from public, anon;
revoke execute on function open_capture_for_review(uuid) from public, anon;
revoke execute on function review_capture(uuid, capture_state, text) from public, anon;
revoke execute on function decide_capture_withdrawal(uuid, withdrawal_decision, text) from public, anon;
grant execute on function withdraw_capture(uuid, text) to authenticated;
grant execute on function open_capture_for_review(uuid) to authenticated;
grant execute on function review_capture(uuid, capture_state, text) to authenticated;
grant execute on function decide_capture_withdrawal(uuid, withdrawal_decision, text) to authenticated;

create or replace view review_queue
with (security_invoker = true) as
select c.id,
       c.org_id,
       c.person_id,
       p.display_name              as student,
       c.state,
       c.kind,
       c.mime,
       c.duration_s,
       c.width,
       c.height,
       c.master_bytes,
       c.bucket,
       c.storage_key,
       c.proxy_key,
       c.scan_status,
       c.exif_stripped,
       c.no_people_in_frame,
       c.checklist_ticked,
       c.created_at,
       c.submitted_at,
       ctx.one_liner,
       ctx.location_label,
       i.id                        as idea_id,
       i.title                     as idea_title,
       i.brief                     as idea_brief,
       i.format_spec,
       cam.name                    as campaign_name,
       capture_consent_blockers(c.id) as consent_blockers,
       c.media_type,
       c.orientation,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', sm.id, 'sort_order', sm.sort_order,
           'width', sm.width, 'height', sm.height,
           'mime_type', sm.mime_type, 'file_size', sm.file_size
         ) order by sm.sort_order)
           from submission_media sm where sm.submission_id = c.id
       ), '[]'::jsonb) as media_items,
       c.state_changed_at,
       c.review_started_at,
       c.review_started_by,
       c.withdrawn_at,
       c.retention_due_at
  from captures c
  join people p       on p.id   = c.person_id
  join ideas i        on i.id   = c.prompt_id
  join campaigns cam  on cam.id = i.campaign_id
  left join capture_context ctx on ctx.capture_id = c.id;
