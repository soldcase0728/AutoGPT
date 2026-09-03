-- Automated media safety screening. Human review remains on captures.state;
-- these tables form an independent, advisory safety lifecycle and a hard
-- publication prerequisite.

create type safety_screen_status as enum (
  'pending', 'processing', 'no_flags', 'flags_detected', 'screening_failed',
  'cancelled', 'superseded'
);
create type safety_risk_level as enum ('low', 'medium', 'high');
create type safety_finding_severity as enum ('low', 'medium', 'high');
create type safety_finding_resolution as enum (
  'unreviewed', 'accepted_context', 'false_positive', 'addressed'
);
create type safety_feedback_label as enum (
  'true_positive', 'false_positive', 'false_negative', 'true_negative', 'unsure'
);
create type safety_job_kind as enum (
  'analyze_image', 'extract_video', 'analyze_video_frame',
  'transcribe_audio', 'analyze_transcript', 'finalize_screen', 'cleanup'
);
create type safety_job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

create type safety_finding_category as enum (
  'profanity_text', 'profanity_speech', 'sexual_or_obscene_language',
  'threatening_language', 'harassment_or_slur', 'student_id_badge',
  'name_on_document', 'class_schedule', 'email_address', 'phone_number',
  'postal_address', 'birth_date', 'possible_medical_private_information',
  'license_plate', 'sensitive_device_screen', 'nudity_or_sexual_content',
  'violence', 'weapon', 'drugs', 'alcohol', 'vaping_or_smoking',
  'obscene_gesture', 'inappropriate_activity', 'identifiable_person'
);

alter table captures
  add column media_revision integer not null default 1 check (media_revision > 0);
alter table submission_media
  add column media_revision integer not null default 1 check (media_revision > 0),
  add column checksum text;

alter table submission_media drop constraint submission_media_submission_id_sort_order_key;
alter table submission_media add constraint submission_media_revision_sort_key
  unique (submission_id, media_revision, sort_order);

-- The compatibility mirror still serves first-generation upload clients. It
-- must target the revision-aware key before another capture can be inserted.
create or replace function mirror_capture_primary_media()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into submission_media (
    submission_id, media_revision, media_type, bucket, storage_key, sort_order,
    width, height, duration, mime_type, file_size, created_at)
  values (
    new.id, new.media_revision,
    case new.kind when 'photo' then 'photo'::prompt_media_type
                  else 'video'::prompt_media_type end,
    new.bucket, new.storage_key, 0,
    new.width, new.height, new.duration_s, new.mime, new.master_bytes, new.created_at)
  on conflict (submission_id, media_revision, sort_order) do nothing;
  return new;
end;
$$;

create index submission_media_revision_idx
  on submission_media (submission_id, media_revision, sort_order);

create table safety_screens (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  capture_id            uuid not null references captures(id) on delete cascade,
  media_revision        integer not null check (media_revision > 0),
  media_manifest        jsonb not null,
  media_manifest_hash   text not null,
  status                safety_screen_status not null default 'pending',
  provider              text,
  model                 text,
  prompt_version        text,
  overall_risk_level    safety_risk_level,
  attempt_count         integer not null default 0 check (attempt_count >= 0),
  started_at            timestamptz,
  completed_at          timestamptz,
  processing_time_ms    bigint check (processing_time_ms is null or processing_time_ms >= 0),
  sampled_frame_count   integer check (sampled_frame_count is null or sampled_frame_count >= 0),
  media_duration_ms     bigint check (media_duration_ms is null or media_duration_ms >= 0),
  provider_usage        jsonb not null default '{}'::jsonb,
  estimated_cost_usd    numeric(12,6),
  error_code            text,
  error_detail_safe     text,
  cancelled_at          timestamptz,
  superseded_by         uuid references safety_screens(id),
  created_at            timestamptz not null default now(),
  unique (capture_id, media_revision),
  check (jsonb_typeof(media_manifest) = 'array')
);

create index safety_screens_org_status_idx on safety_screens(org_id, status, created_at);
create index safety_screens_capture_idx on safety_screens(capture_id, media_revision desc);

create table safety_findings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  safety_screen_id      uuid not null references safety_screens(id) on delete cascade,
  source_job_id         uuid,
  submission_media_id   uuid not null references submission_media(id) on delete cascade,
  category              safety_finding_category not null,
  severity              safety_finding_severity not null,
  confidence            numeric(4,3) not null check (confidence between 0 and 1),
  description           text not null check (length(trim(description)) > 0),
  start_ms              bigint check (start_ms is null or start_ms >= 0),
  end_ms                bigint check (end_ms is null or end_ms >= coalesce(start_ms, 0)),
  bounding_box          jsonb,
  detector              text not null,
  resolution_status     safety_finding_resolution not null default 'unreviewed',
  resolved_by           uuid references people(id),
  resolved_at           timestamptz,
  resolution_reason     text,
  created_at            timestamptz not null default now(),
  check (bounding_box is null or
         (jsonb_typeof(bounding_box) = 'object'
          and (bounding_box->>'x')::numeric between 0 and 1
          and (bounding_box->>'y')::numeric between 0 and 1
          and (bounding_box->>'width')::numeric between 0 and 1
          and (bounding_box->>'height')::numeric between 0 and 1)),
  check ((resolution_status = 'unreviewed' and resolved_by is null and resolved_at is null)
         or (resolution_status <> 'unreviewed' and resolved_by is not null
             and resolved_at is not null and length(trim(resolution_reason)) > 0))
);

create index safety_findings_screen_idx on safety_findings(safety_screen_id, severity, created_at);
create index safety_findings_media_idx on safety_findings(submission_media_id, start_ms);

create table safety_feedback (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  safety_screen_id      uuid not null references safety_screens(id) on delete cascade,
  safety_finding_id     uuid references safety_findings(id) on delete cascade,
  label                 safety_feedback_label not null,
  category              safety_finding_category,
  note                  text,
  created_by            uuid not null references people(id),
  created_at            timestamptz not null default now()
);

create table safety_feedback_audits (
  id                    bigserial primary key,
  feedback_id           uuid not null references safety_feedback(id) on delete cascade,
  org_id                uuid not null references organizations(id) on delete cascade,
  actor_id              uuid not null references people(id),
  old_label             safety_feedback_label,
  new_label             safety_feedback_label not null,
  note                  text,
  at                    timestamptz not null default now()
);

create table safety_screen_overrides (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  safety_screen_id      uuid not null references safety_screens(id) on delete cascade,
  reason                text not null check (length(trim(reason)) > 0),
  created_by            uuid not null references people(id),
  created_at            timestamptz not null default now(),
  unique (safety_screen_id)
);

-- Internal durable queue. It intentionally has no authenticated RLS policy;
-- workers interact through service-role-only claim/completion RPCs.
create table safety_jobs (
  id                    uuid primary key default gen_random_uuid(),
  safety_screen_id      uuid not null references safety_screens(id) on delete cascade,
  submission_media_id   uuid references submission_media(id) on delete cascade,
  kind                  safety_job_kind not null,
  dedupe_key            text not null unique,
  payload               jsonb not null default '{}'::jsonb,
  status                safety_job_status not null default 'pending',
  attempt_count         integer not null default 0 check (attempt_count >= 0),
  available_at          timestamptz not null default now(),
  lease_token           uuid,
  lease_expires_at      timestamptz,
  heartbeat_at          timestamptz,
  last_error_code       text,
  last_error_safe       text,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

alter table safety_findings
  add constraint safety_findings_source_job_fk foreign key (source_job_id)
  references safety_jobs(id) on delete set null;
create index safety_findings_source_job_idx on safety_findings(source_job_id);

create index safety_jobs_claim_idx
  on safety_jobs(status, available_at, created_at)
  where status in ('pending', 'processing');

insert into storage.buckets(id, name, public)
values ('safety-temp', 'safety-temp', false)
on conflict (id) do update set public = false;

alter table safety_screens enable row level security;
alter table safety_findings enable row level security;
alter table safety_feedback enable row level security;
alter table safety_feedback_audits enable row level security;
alter table safety_screen_overrides enable row level security;
alter table safety_jobs enable row level security;

create policy safety_screens_staff_read on safety_screens for select
  using (app_is_staff() and org_id = app_current_org_id());
create policy safety_findings_staff_read on safety_findings for select
  using (app_is_staff() and org_id = app_current_org_id());
create policy safety_feedback_staff_read on safety_feedback for select
  using (app_is_staff() and org_id = app_current_org_id());
create policy safety_feedback_audits_staff_read on safety_feedback_audits for select
  using (app_is_staff() and org_id = app_current_org_id());
create policy safety_screen_overrides_staff_read on safety_screen_overrides for select
  using (app_is_staff() and org_id = app_current_org_id());

grant select on safety_screens, safety_findings, safety_feedback,
  safety_feedback_audits, safety_screen_overrides to authenticated;
grant all on safety_screens, safety_findings, safety_feedback,
  safety_feedback_audits, safety_screen_overrides, safety_jobs to service_role;
grant usage, select on sequence safety_feedback_audits_id_seq to service_role;
revoke all on safety_jobs from public, anon, authenticated;
revoke insert, update, delete on safety_screens, safety_findings, safety_feedback,
  safety_feedback_audits, safety_screen_overrides from authenticated;
revoke all on safety_screens, safety_findings, safety_feedback,
  safety_feedback_audits, safety_screen_overrides, safety_jobs from anon;

create or replace function enqueue_capture_safety_screen()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_screen_id uuid;
  v_manifest jsonb;
  v_hash text;
  v_media record;
begin
  if new.state <> 'submitted' or old.state = 'submitted' then return new; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', sm.id, 'media_type', sm.media_type, 'bucket', sm.bucket,
           'storage_key', sm.storage_key, 'sort_order', sm.sort_order,
           'checksum', sm.checksum, 'file_size', sm.file_size,
           'mime_type', sm.mime_type) order by sm.sort_order), '[]'::jsonb)
    into v_manifest
    from submission_media sm
   where sm.submission_id = new.id and sm.media_revision = new.media_revision;

  if jsonb_array_length(v_manifest) = 0 then
    raise exception 'cannot enqueue safety screen without submission media'
      using errcode = 'check_violation';
  end if;
  v_hash := encode(extensions.digest(v_manifest::text, 'sha256'), 'hex');

  insert into safety_screens(org_id, capture_id, media_revision, media_manifest, media_manifest_hash)
  values (new.org_id, new.id, new.media_revision, v_manifest, v_hash)
  on conflict (capture_id, media_revision) do nothing
  returning id into v_screen_id;
  if v_screen_id is null then return new; end if;

  for v_media in
    select * from submission_media
     where submission_id = new.id and media_revision = new.media_revision
     order by sort_order
  loop
    insert into safety_jobs(safety_screen_id, submission_media_id, kind, dedupe_key)
    values (v_screen_id, v_media.id,
            case when v_media.media_type = 'photo'
                 then 'analyze_image'::safety_job_kind
                 else 'extract_video'::safety_job_kind end,
            v_screen_id::text || ':' || v_media.id::text || ':source')
    on conflict (dedupe_key) do nothing;
  end loop;

  insert into audit_log(org_id, actor_id, action, subject_type, subject_id, detail)
  values (new.org_id, null, 'safety.screen_enqueued', 'capture', new.id,
          jsonb_build_object('screen_id', v_screen_id, 'media_revision', new.media_revision));
  return new;
end;
$$;

create trigger captures_enqueue_safety
  after update of state on captures
  for each row execute function enqueue_capture_safety_screen();

create or replace function cancel_ineligible_safety_work()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state in ('withdrawal_requested', 'withdrawn') or new.takedown_at is not null then
    update safety_screens set status = 'cancelled', cancelled_at = now(), completed_at = now(),
      error_code = 'media_unavailable'
      where capture_id = new.id and status in ('pending', 'processing');
    update safety_jobs set status = 'cancelled', completed_at = now(), lease_token = null,
      lease_expires_at = null
      where safety_screen_id in (select id from safety_screens where capture_id = new.id)
        and status in ('pending', 'processing');
  end if;
  return new;
end;
$$;

create trigger captures_cancel_safety
  after update of state, takedown_at on captures
  for each row execute function cancel_ineligible_safety_work();

-- Opens a new immutable media revision only after staff requested changes.
create or replace function begin_capture_resubmission(p_capture_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := app_current_person_id(); v_capture captures; v_revision integer;
begin
  select * into v_capture from captures where id = p_capture_id for update;
  if not found or v_capture.person_id <> v_actor then
    raise exception 'capture does not exist' using errcode = 'insufficient_privilege';
  end if;
  if v_capture.state <> 'changes_requested' then
    raise exception 'only a requested reshoot may be reopened' using errcode = 'check_violation';
  end if;
  v_revision := v_capture.media_revision + 1;
  update captures set state = 'uploading', media_revision = v_revision,
    submitted_at = null, review_started_at = null, review_started_by = null,
    withdrawn_at = null, duration_s = null, width = null, height = null,
    mime = null, master_bytes = null, checksum = null, proxy_key = null,
    no_people_in_frame = false, checklist_ticked = '{}', guideline_version_ids = '{}'
   where id = p_capture_id;
  delete from capture_people where capture_id = p_capture_id;
  update assignments set completed_at = null where id = v_capture.assignment_id;
  insert into audit_log(org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_capture.org_id, v_actor, 'capture.resubmission_started', 'capture', p_capture_id,
          jsonb_build_object('media_revision', v_revision));
  return v_revision;
end;
$$;

create or replace function claim_safety_job(p_lease_seconds integer default 120)
returns safety_jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job safety_jobs;
begin
  select * into v_job from safety_jobs
   where (status = 'pending' and available_at <= now())
      or (status = 'processing' and lease_expires_at < now())
   order by available_at, created_at
   for update skip locked limit 1;
  if not found then return null; end if;
  update safety_jobs set status = 'processing', attempt_count = attempt_count + 1,
    lease_token = gen_random_uuid(), heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds))
    where id = v_job.id returning * into v_job;
  update safety_screens set status = 'processing', started_at = coalesce(started_at, now()),
    attempt_count = greatest(attempt_count, v_job.attempt_count)
    where id = v_job.safety_screen_id and status = 'pending';
  return v_job;
end;
$$;

create or replace function heartbeat_safety_job(p_job_id uuid, p_lease_token uuid,
                                                  p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update safety_jobs set heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds))
    where id = p_job_id and lease_token = p_lease_token and status = 'processing';
  return found;
end;
$$;

create or replace function record_safety_job_findings(p_job_id uuid, p_lease_token uuid,
                                                       p_findings jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job safety_jobs; v_org uuid; v_count integer;
begin
  select * into v_job from safety_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'processing' or v_job.lease_token <> p_lease_token
     or v_job.lease_expires_at <= now() then
    raise exception 'safety job lease was lost' using errcode = 'serialization_failure';
  end if;
  if v_job.submission_media_id is null or jsonb_typeof(p_findings) <> 'array' then
    raise exception 'invalid finding payload' using errcode = 'check_violation';
  end if;
  select org_id into v_org from safety_screens where id = v_job.safety_screen_id;
  delete from safety_findings where source_job_id = v_job.id;
  insert into safety_findings(
    org_id, safety_screen_id, source_job_id, submission_media_id, category,
    severity, confidence, description, start_ms, end_ms, bounding_box, detector)
  select v_org, v_job.safety_screen_id, v_job.id, v_job.submission_media_id,
         (x->>'category')::safety_finding_category,
         (x->>'severity')::safety_finding_severity,
         (x->>'confidence')::numeric, x->>'description',
         nullif(x->>'start_ms', '')::bigint, nullif(x->>'end_ms', '')::bigint,
         case when x->'bounding_box' = 'null'::jsonb then null else x->'bounding_box' end,
         x->>'detector'
    from jsonb_array_elements(p_findings) x;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Add provider metering atomically because video frame jobs can complete in parallel.
-- Only explicit numeric counters are accepted; raw provider responses are never stored.
create or replace function record_safety_job_usage(p_job_id uuid, p_lease_token uuid,
                                                    p_usage jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job safety_jobs;
begin
  select * into v_job from safety_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'processing' or v_job.lease_token <> p_lease_token
     or v_job.lease_expires_at <= now() then
    raise exception 'safety job lease was lost' using errcode = 'serialization_failure';
  end if;
  if jsonb_typeof(p_usage) <> 'object'
     or coalesce((p_usage->>'input_tokens')::numeric, 0) < 0
     or coalesce((p_usage->>'output_tokens')::numeric, 0) < 0
     or coalesce((p_usage->>'moderation_requests')::numeric, 0) < 0
     or coalesce((p_usage->>'transcription_seconds')::numeric, 0) < 0 then
    raise exception 'invalid provider usage payload' using errcode = 'check_violation';
  end if;
  update safety_screens
     set provider_usage = provider_usage || jsonb_build_object(
       'input_tokens', coalesce((provider_usage->>'input_tokens')::numeric, 0)
         + coalesce((p_usage->>'input_tokens')::numeric, 0),
       'output_tokens', coalesce((provider_usage->>'output_tokens')::numeric, 0)
         + coalesce((p_usage->>'output_tokens')::numeric, 0),
       'moderation_requests', coalesce((provider_usage->>'moderation_requests')::numeric, 0)
         + coalesce((p_usage->>'moderation_requests')::numeric, 0),
       'transcription_seconds', coalesce((provider_usage->>'transcription_seconds')::numeric, 0)
         + coalesce((p_usage->>'transcription_seconds')::numeric, 0))
   where id = v_job.safety_screen_id;
end;
$$;

create or replace function record_safety_feedback(p_screen_id uuid, p_finding_id uuid,
                                                   p_label safety_feedback_label,
                                                   p_category safety_finding_category,
                                                   p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := app_current_person_id(); v_org uuid; v_id uuid;
begin
  if not app_is_staff() then raise exception 'staff only' using errcode = 'insufficient_privilege'; end if;
  if p_label = 'false_negative' and p_category is null then
    raise exception 'a false negative needs a category' using errcode = 'check_violation';
  end if;
  select org_id into v_org from safety_screens
   where id = p_screen_id and org_id = app_current_org_id();
  if not found then raise exception 'screen does not exist'; end if;
  if p_finding_id is not null and not exists (
    select 1 from safety_findings where id = p_finding_id and safety_screen_id = p_screen_id
  ) then raise exception 'finding does not belong to screen' using errcode = 'check_violation'; end if;
  insert into safety_feedback(org_id, safety_screen_id, safety_finding_id, label, category, note, created_by)
  values (v_org, p_screen_id, p_finding_id, p_label, p_category, nullif(trim(p_note), ''), v_actor)
  returning id into v_id;
  insert into safety_feedback_audits(feedback_id, org_id, actor_id, new_label, note)
  values (v_id, v_org, v_actor, p_label, nullif(trim(p_note), ''));
  insert into audit_log(org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, v_actor, 'safety.feedback_recorded', 'safety_screen', p_screen_id,
          jsonb_build_object('feedback_id', v_id, 'finding_id', p_finding_id,
                             'label', p_label, 'category', p_category));
  return v_id;
end;
$$;

create or replace function fail_stale_safety_screens(p_after interval default interval '30 minutes')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  with failed as (
    update safety_screens s set status = 'screening_failed', completed_at = now(),
      error_code = 'worker_unavailable', error_detail_safe = 'Automated review did not complete in time.'
     where s.status in ('pending', 'processing')
       and coalesce(s.started_at, s.created_at) < now() - p_after
       and not exists (select 1 from safety_jobs j where j.safety_screen_id = s.id
         and j.status = 'processing' and j.lease_expires_at > now())
     returning id
  ) select count(*) into v_count from failed;
  return v_count;
end;
$$;

create or replace function resolve_safety_finding(p_finding_id uuid,
                                                   p_resolution safety_finding_resolution,
                                                   p_reason text)
returns safety_findings language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := app_current_person_id(); v_finding safety_findings;
begin
  if not app_is_staff() then raise exception 'staff only' using errcode = 'insufficient_privilege'; end if;
  if p_resolution = 'unreviewed' or length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'a resolution and reason are required' using errcode = 'check_violation';
  end if;
  update safety_findings set resolution_status = p_resolution, resolved_by = v_actor,
    resolved_at = now(), resolution_reason = trim(p_reason)
    where id = p_finding_id and org_id = app_current_org_id()
    returning * into v_finding;
  if not found then raise exception 'finding does not exist'; end if;
  insert into audit_log(org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_finding.org_id, v_actor, 'safety.finding_resolved', 'safety_finding', v_finding.id,
          jsonb_build_object('resolution', p_resolution, 'reason', trim(p_reason)));
  return v_finding;
end;
$$;

create or replace function override_failed_safety_screen(p_screen_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := app_current_person_id(); v_org uuid; v_id uuid;
begin
  if not app_is_staff() then raise exception 'staff only' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'an override reason is required' using errcode = 'check_violation';
  end if;
  select org_id into v_org from safety_screens
   where id = p_screen_id and org_id = app_current_org_id() and status = 'screening_failed';
  if not found then raise exception 'only a failed screen may be overridden' using errcode = 'check_violation'; end if;
  insert into safety_screen_overrides(org_id, safety_screen_id, reason, created_by)
  values (v_org, p_screen_id, trim(p_reason), v_actor)
  on conflict (safety_screen_id) do update set reason = excluded.reason,
    created_by = excluded.created_by, created_at = now()
  returning id into v_id;
  insert into audit_log(org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, v_actor, 'safety.failed_screen_overridden', 'safety_screen', p_screen_id,
          jsonb_build_object('reason', trim(p_reason)));
  return v_id;
end;
$$;

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

create or replace function enforce_consent_before_publish()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state = 'published' and old.state is distinct from 'published' then
    if not capture_ready_to_post(new.id) then
      raise exception 'capture % cannot be published; blockers: %',
        new.id, capture_publication_blockers(new.id) using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function enqueue_capture_safety_screen() from public, anon, authenticated;
revoke execute on function cancel_ineligible_safety_work() from public, anon, authenticated;
revoke execute on function claim_safety_job(integer) from public, anon, authenticated;
revoke execute on function heartbeat_safety_job(uuid,uuid,integer) from public, anon, authenticated;
revoke execute on function fail_stale_safety_screens(interval) from public, anon, authenticated;
revoke execute on function record_safety_feedback(uuid,uuid,safety_feedback_label,safety_finding_category,text) from public, anon;
revoke execute on function record_safety_job_findings(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function record_safety_job_usage(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function begin_capture_resubmission(uuid) from public, anon;
revoke execute on function resolve_safety_finding(uuid,safety_finding_resolution,text) from public, anon;
revoke execute on function override_failed_safety_screen(uuid,text) from public, anon;
revoke execute on function capture_safety_ok(uuid) from public, anon;
revoke execute on function capture_publication_blockers(uuid) from public, anon;
revoke execute on function capture_ready_to_post(uuid) from public, anon;
grant execute on function claim_safety_job(integer) to service_role;
grant execute on function heartbeat_safety_job(uuid,uuid,integer) to service_role;
grant execute on function fail_stale_safety_screens(interval) to service_role;
grant execute on function record_safety_feedback(uuid,uuid,safety_feedback_label,safety_finding_category,text) to authenticated;
grant execute on function record_safety_job_findings(uuid,uuid,jsonb) to service_role;
grant execute on function record_safety_job_usage(uuid,uuid,jsonb) to service_role;
grant execute on function begin_capture_resubmission(uuid) to authenticated;
grant execute on function resolve_safety_finding(uuid,safety_finding_resolution,text) to authenticated;
grant execute on function override_failed_safety_screen(uuid,text) to authenticated;
grant execute on function capture_safety_ok(uuid), capture_publication_blockers(uuid),
  capture_ready_to_post(uuid) to authenticated;

-- Reviewer feed keeps human state and computed safety/posting state separate.
create or replace view review_safety_summary with (security_invoker = true) as
select s.capture_id, s.id as safety_screen_id, s.status as safety_status,
       s.overall_risk_level, s.error_code,
       count(f.id) as finding_count,
       count(f.id) filter (where f.resolution_status = 'unreviewed') as unresolved_finding_count,
       exists(select 1 from safety_screen_overrides o where o.safety_screen_id = s.id) as failed_scan_overridden
  from safety_screens s
  left join safety_findings f on f.safety_screen_id = s.id
 where s.media_revision = (select c.media_revision from captures c where c.id = s.capture_id)
 group by s.id;
grant select on review_safety_summary to authenticated;

-- Only this trusted RPC can take a student from changes_requested back to an
-- uploading revision. Ordinary student updates remain restricted by RLS.
create or replace function enforce_capture_state_transitions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_person uuid := app_current_person_id();
begin
  if new.state = old.state then return new; end if;
  if v_person is null or app_is_staff() then return new; end if;
  if old.state = 'uploading' and new.state = 'submitted' then return new; end if;
  if old.state = 'changes_requested' and new.state = 'uploading'
     and old.person_id = v_person and new.media_revision = old.media_revision + 1 then return new; end if;
  raise exception 'student capture transition % -> % is not allowed', old.state, new.state
    using errcode = 'insufficient_privilege';
end;
$$;

create or replace view review_queue
with (security_invoker = true) as
select c.id, c.org_id, c.person_id, p.display_name as student,
       c.state, c.kind, c.mime,
       c.duration_s, c.width, c.height, c.master_bytes, c.bucket, c.storage_key,
       c.proxy_key, c.scan_status, c.exif_stripped, c.no_people_in_frame,
       c.checklist_ticked, c.created_at, c.submitted_at, ctx.one_liner,
       ctx.location_label, i.id as idea_id, i.title as idea_title, i.brief as idea_brief,
       i.format_spec, cam.name as campaign_name, capture_consent_blockers(c.id) as consent_blockers,
       c.media_type, c.orientation,
       coalesce((select jsonb_agg(jsonb_build_object(
         'id', sm.id, 'sort_order', sm.sort_order, 'width', sm.width, 'height', sm.height,
         'mime_type', sm.mime_type, 'file_size', sm.file_size) order by sm.sort_order)
         from submission_media sm where sm.submission_id = c.id
           and sm.media_revision = c.media_revision), '[]'::jsonb) as media_items,
       c.state_changed_at, c.review_started_at, c.review_started_by,
       c.withdrawn_at, c.retention_due_at,
       p.participation as student_participation
  from captures c join people p on p.id = c.person_id join ideas i on i.id = c.prompt_id
  join campaigns cam on cam.id = i.campaign_id
  left join capture_context ctx on ctx.capture_id = c.id;

-- Existing open submissions are not grandfathered around the new gate.
-- Their current immutable media revision enters the same durable queue.
with manifests as (
  select c.id as capture_id, c.org_id, c.media_revision,
         jsonb_agg(jsonb_build_object(
           'id', sm.id, 'media_type', sm.media_type, 'bucket', sm.bucket,
           'storage_key', sm.storage_key, 'sort_order', sm.sort_order,
           'checksum', sm.checksum, 'file_size', sm.file_size,
           'mime_type', sm.mime_type) order by sm.sort_order) as manifest
    from captures c join submission_media sm on sm.submission_id = c.id
     and sm.media_revision = c.media_revision
   where c.state in ('submitted', 'in_review', 'approved') and c.takedown_at is null
   group by c.id
)
insert into safety_screens(org_id, capture_id, media_revision, media_manifest, media_manifest_hash)
select org_id, capture_id, media_revision, manifest,
       encode(extensions.digest(manifest::text, 'sha256'), 'hex')
  from manifests
on conflict (capture_id, media_revision) do nothing;

insert into safety_jobs(safety_screen_id, submission_media_id, kind, dedupe_key)
select s.id, sm.id,
       case when sm.media_type = 'photo' then 'analyze_image'::safety_job_kind
            else 'extract_video'::safety_job_kind end,
       s.id::text || ':' || sm.id::text || ':source'
  from safety_screens s join submission_media sm on sm.submission_id = s.capture_id
   and sm.media_revision = s.media_revision
 where s.status = 'pending'
on conflict (dedupe_key) do nothing;
