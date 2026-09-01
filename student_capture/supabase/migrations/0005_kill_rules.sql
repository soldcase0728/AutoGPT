-- Product kill rules, enforced in the database so no client can route around
-- them. Each block names the rule it defends.

-- ---------------------------------------------------------------- rule 7
-- Being on the roster is not being approved. A school email address, and even
-- a claimed roster row, is only ever `pending` until a human moves it on.

create type participation_state as enum ('pending', 'active', 'revoked');

alter table people
  add column participation participation_state not null default 'pending',
  add column participation_changed_at timestamptz,
  add column participation_changed_by uuid references people (id);

-- Existing rows predate the rule; treat staff as active and leave students
-- pending so nobody is silently grandfathered into submitting.
update people set participation = 'active' where role in ('reviewer', 'admin');

create or replace function app_is_active_participant()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from people p
     where p.auth_user_id = auth.uid()
       and p.deactivated_at is null
       and p.participation = 'active')
$$;

-- ---------------------------------------------------------------- rule 1
-- A submission is never an approval. Whatever the client sends, a student can
-- only ever move their own capture from `uploading` to `submitted`.

drop policy if exists captures_insert_own on captures;
create policy captures_insert_own on captures for insert
  with check (person_id = app_current_person_id()
              and org_id = app_current_org_id()
              -- rule 7: pending and revoked people cannot file captures.
              and app_is_active_participant()
              and state = 'uploading');

drop policy if exists captures_update_own_while_uploading on captures;
create policy captures_update_own_while_uploading on captures for update
  using (person_id = app_current_person_id() and state = 'uploading')
  with check (person_id = app_current_person_id()
              -- The hole this closes: without a state predicate here a student
              -- could update straight from `uploading` to `approved`.
              and state in ('uploading', 'submitted'));

-- Belt and braces: a trigger states the whole rule, so it holds even if a
-- future policy is loosened by accident.
create or replace function enforce_capture_state_transitions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_person uuid := app_current_person_id();
begin
  if new.state = old.state then
    return new;
  end if;

  -- No signed-in person means a trusted server-side path (the service role, or
  -- the revocation trigger below). Only a signed-in non-staff actor is bound.
  if v_person is null or app_is_staff() then
    return new;
  end if;

  if not (old.state = 'uploading' and new.state = 'submitted') then
    raise exception
      'a student may only move a capture from uploading to submitted (tried % -> %)',
      old.state, new.state
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger captures_state_machine
  before update on captures
  for each row execute function enforce_capture_state_transitions();

-- ---------------------------------------------------------------- rule 5
-- Protected material discovered after posting has to come down, and the reason
-- has to survive.

alter table captures
  add column takedown_at timestamptz,
  add column takedown_reason text,
  add column takedown_by uuid references people (id);

create or replace function take_down_capture(
  p_capture_id uuid,
  p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_org   uuid;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may take a capture down'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a takedown needs a reason' using errcode = 'check_violation';
  end if;

  select org_id into v_org from captures where id = p_capture_id;
  if v_org is null then
    raise exception 'capture % does not exist', p_capture_id;
  end if;

  update captures
     set state = 'rejected',
         takedown_at = now(),
         takedown_reason = p_reason,
         takedown_by = v_actor
   where id = p_capture_id;

  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, v_actor, 'capture.taken_down', 'capture', p_capture_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------- rule 6
-- Unsafe filming is not part of the programme, and anyone must be able to say
-- so — including the student who was asked to do it.

create type safety_kind as enum (
  'unsafe_filming',      -- walking-and-filming, traffic, stairs, hallways
  'protected_material',  -- grades, schedules, rosters, ID cards
  'prohibited_content',  -- alcohol, vaping, gambling
  'other');

create table safety_flags (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id) on delete cascade,
  capture_id      uuid references captures (id) on delete set null,
  idea_id         uuid references ideas (id) on delete set null,
  reported_by     uuid references people (id) on delete set null,
  kind            safety_kind not null,
  detail          text not null,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references people (id)
);

create index safety_flags_open_idx
  on safety_flags (org_id, created_at desc) where acknowledged_at is null;

alter table safety_flags enable row level security;

-- Anyone in the organisation may raise one; only staff may read the whole
-- board or close one out.
create policy safety_flags_insert on safety_flags for insert
  with check (reported_by = app_current_person_id()
              and org_id = app_current_org_id());

create policy safety_flags_read on safety_flags for select
  using (reported_by = app_current_person_id()
         or (app_is_staff() and org_id = app_current_org_id()));

create policy safety_flags_staff_update on safety_flags for update
  using (app_is_staff() and org_id = app_current_org_id())
  with check (app_is_staff() and org_id = app_current_org_id());

-- Every flag lands in the audit trail whether or not the alert webhook fires.
create or replace function log_safety_flag()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (new.org_id,
          new.reported_by,
          'safety.flagged',
          case when new.capture_id is not null then 'capture' else 'idea' end,
          coalesce(new.capture_id, new.idea_id),
          jsonb_build_object('kind', new.kind, 'detail', new.detail));
  return new;
end;
$$;

create trigger safety_flags_audit
  after insert on safety_flags
  for each row execute function log_safety_flag();

-- ---------------------------------------------------------------- rule 3
-- New legal language needs a new affirmative acceptance. This answers "has
-- this person accepted THIS wording", never "have they ever accepted anything".

create or replace function has_current_release(p_person_id uuid, p_version text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from consents c
     where c.person_id = p_person_id
       and c.type = 'media_release'
       and c.document_version = p_version
       and c.revoked_at is null
       and (c.expires_at is null or c.expires_at > now()))
$$;

-- Rule 2 is the other half of the same coin: acceptance is per version and
-- rows are append-only, so a student who has accepted the current wording is
-- never asked again, and an older acceptance is never overwritten.
create or replace function guard_consent_immutability()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.document_version is distinct from old.document_version
     or new.signed_at is distinct from old.signed_at
     or new.person_id is distinct from old.person_id
     or new.type is distinct from old.type then
    raise exception
      'a consent record is evidence; supersede it with a new row rather than editing it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger consents_immutable
  before update on consents
  for each row execute function guard_consent_immutability();
