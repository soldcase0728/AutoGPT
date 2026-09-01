-- Student Capture, phase 1 schema.
--
-- Two joins carry the design:
--   captures -> capture_people -> consents      answers "may this be published"
--   captures.guideline_version_ids              answers "under what rules was it shot"
-- Everything else is convenience.

create extension if not exists "pgcrypto";

create type person_role     as enum ('student', 'reviewer', 'admin');
create type guideline_kind  as enum ('craft', 'brand');
create type consent_type    as enum ('media_release', 'parental', 'nil');
create type capture_kind    as enum ('video', 'photo');
create type scan_state      as enum ('pending', 'clean', 'infected', 'failed');
create type capture_state   as enum (
  'uploading', 'submitted', 'in_review', 'approved',
  'changes_requested', 'rejected', 'published'
);

-- ---------------------------------------------------------------- orgs/people

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table people (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id) on delete cascade,
  auth_user_id   uuid unique references auth.users (id) on delete set null,
  role           person_role not null default 'student',
  display_name   text not null,
  email          text not null,
  phone          text,
  -- Year only, never a full date of birth. It is all the consent gate needs to
  -- decide whether a parental release is required, and a year is far less
  -- damaging to hold. NULL means unknown, which the gate treats as a blocker.
  birth_year     integer check (birth_year between 1900 and 2100),
  created_at     timestamptz not null default now(),
  deactivated_at timestamptz
);

create unique index people_org_email_key on people (org_id, lower(email));
create index people_org_role_idx on people (org_id, role) where deactivated_at is null;

-- ------------------------------------------------------------------ guidelines

create table guideline_sets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  kind       guideline_kind not null,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Guidelines are versioned with an effective date so a capture can point at the
-- exact wording it was shot under, years later.
create table guideline_versions (
  id             uuid primary key default gen_random_uuid(),
  set_id         uuid not null references guideline_sets (id) on delete cascade,
  version        integer not null,
  -- { "summary": text, "items": [{ "id": text, "text": text, "required": bool }] }
  body           jsonb not null,
  effective_from timestamptz not null default now(),
  superseded_at  timestamptz,
  unique (set_id, version)
);

create index guideline_versions_live_idx
  on guideline_versions (set_id) where superseded_at is null;

create table acknowledgements (
  person_id            uuid not null references people (id) on delete cascade,
  guideline_version_id uuid not null references guideline_versions (id) on delete cascade,
  acknowledged_at      timestamptz not null default now(),
  primary key (person_id, guideline_version_id)
);

-- -------------------------------------------------------------------- consents

-- Consent attaches to a PERSON, never to a file. One row per person per type.
create table consents (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references people (id) on delete cascade,
  type             consent_type not null,
  document_version text not null,
  signed_at        timestamptz not null default now(),
  -- Who put their name to it: the person, or a guardian for a parental release.
  signed_by        text not null,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text
);

create index consents_person_idx on consents (person_id, type);

-- ------------------------------------------------------------- campaigns/ideas

create table campaigns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  starts_on  date not null,
  ends_on    date,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table ideas (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns (id) on delete cascade,
  title             text not null,
  brief             text not null,
  -- { "kind": "video"|"photo", "orientation": "portrait"|"landscape"|"any",
  --   "min_seconds": int, "max_seconds": int }
  format_spec       jsonb not null default '{"kind":"video","orientation":"portrait"}'::jsonb,
  reference_urls    text[] not null default '{}',
  guideline_set_ids uuid[] not null default '{}',
  weight            integer not null default 1 check (weight > 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index ideas_campaign_active_idx on ideas (campaign_id) where active;

-- One prompt per student per day. The unique constraint is what makes the 7am
-- job safe to re-run.
create table assignments (
  id           uuid primary key default gen_random_uuid(),
  idea_id      uuid not null references ideas (id) on delete cascade,
  person_id    uuid not null references people (id) on delete cascade,
  due_on       date not null,
  notified_at  timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (person_id, due_on)
);

create index assignments_person_due_idx on assignments (person_id, due_on desc);

-- -------------------------------------------------------------------- captures

create table captures (
  id                   uuid primary key default gen_random_uuid(),
  assignment_id        uuid not null references assignments (id) on delete cascade,
  person_id            uuid not null references people (id) on delete cascade,
  org_id               uuid not null references organizations (id) on delete cascade,

  bucket               text not null,
  storage_key          text not null unique,
  master_bytes         bigint,
  kind                 capture_kind not null default 'video',
  mime                 text,
  duration_s           numeric(8, 2),
  width                integer,
  height               integer,
  captured_at          timestamptz,

  -- The exact guideline wording in force when this was shot.
  guideline_version_ids uuid[] not null default '{}',
  checklist_ticked      text[] not null default '{}',

  -- Set by the phase 2 ingest worker; surfaced in review until it runs.
  checksum             text,
  exif_stripped        boolean not null default false,
  scan_status          scan_state not null default 'pending',
  proxy_key            text,

  -- A student may affirm that nobody identifiable is in frame; otherwise every
  -- person tagged in capture_people must clear the consent gate before publish.
  no_people_in_frame   boolean not null default false,

  state                capture_state not null default 'uploading',
  created_at           timestamptz not null default now(),
  submitted_at         timestamptz
);

create index captures_org_state_idx on captures (org_id, state, submitted_at desc);
create index captures_person_idx on captures (person_id, created_at desc);
create index captures_assignment_idx on captures (assignment_id);

create table capture_people (
  capture_id uuid not null references captures (id) on delete cascade,
  person_id  uuid not null references people (id) on delete cascade,
  primary key (capture_id, person_id)
);

create table capture_context (
  capture_id     uuid primary key references captures (id) on delete cascade,
  one_liner      text not null,
  location_label text
);

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  capture_id  uuid not null references captures (id) on delete cascade,
  reviewer_id uuid not null references people (id) on delete restrict,
  state       capture_state not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index reviews_capture_idx on reviews (capture_id, created_at desc);

create table audit_log (
  id           bigserial primary key,
  org_id       uuid not null references organizations (id) on delete cascade,
  actor_id     uuid references people (id) on delete set null,
  action       text not null,
  subject_type text not null,
  subject_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);

create index audit_log_subject_idx on audit_log (subject_type, subject_id, at desc);
