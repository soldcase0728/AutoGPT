-- Phase 1: generalise prompts and separate submission state from media rows.
--
-- `captures` remains the submission envelope so the existing review, consent,
-- audit, and video paths keep their identifiers. Its media columns are kept as
-- a first-media compatibility projection until those readers move to
-- `submission_media` in Phase 2.

create type prompt_capture_mode as enum ('ASSIGNED', 'OPEN_MOMENT');
create type prompt_media_type as enum ('PHOTO', 'VIDEO');
create type prompt_orientation as enum ('PORTRAIT', 'LANDSCAPE', 'ANY');
create type prompt_repeat_policy as enum ('ONCE', 'MULTIPLE');

alter table ideas
  add column capture_mode prompt_capture_mode not null default 'ASSIGNED',
  add column media_type prompt_media_type,
  add column min_media_count integer not null default 1,
  add column max_media_count integer not null default 1,
  add column required_orientation prompt_orientation,
  add column repeat_submission_policy prompt_repeat_policy not null default 'ONCE',
  add column opens_at timestamptz,
  add column closes_at timestamptz,
  add column max_image_size bigint,
  add column allowed_image_formats text[],
  add column min_image_width integer,
  add column min_image_height integer;

-- Preserve the existing prompt behavior while making the normalized contract
-- available to new APIs.
update ideas
   set media_type = case coalesce(format_spec->>'kind', 'video')
                      when 'photo' then 'PHOTO'::prompt_media_type
                      else 'VIDEO'::prompt_media_type
                    end,
       required_orientation = case coalesce(format_spec->>'orientation', 'any')
                                when 'portrait' then 'PORTRAIT'::prompt_orientation
                                when 'landscape' then 'LANDSCAPE'::prompt_orientation
                                else 'ANY'::prompt_orientation
                              end,
       max_image_size = case when format_spec->>'kind' = 'photo'
                             then 536870912 else null end,
       allowed_image_formats = case when format_spec->>'kind' = 'photo'
                                    then array['image/jpeg', 'image/png', 'image/webp']
                                    else null end;

alter table ideas
  alter column media_type set not null,
  alter column required_orientation set not null,
  add constraint ideas_media_count_check
    check (min_media_count >= 1 and max_media_count >= min_media_count),
  add constraint ideas_active_window_check
    check (opens_at is null or closes_at is null or opens_at < closes_at),
  add constraint ideas_image_size_check
    check (max_image_size is null or max_image_size > 0),
  add constraint ideas_image_width_check
    check (min_image_width is null or min_image_width > 0),
  add constraint ideas_image_height_check
    check (min_image_height is null or min_image_height > 0),
  add constraint ideas_photo_formats_check
    check (media_type <> 'PHOTO' or coalesce(cardinality(allowed_image_formats), 0) > 0);

create index ideas_mode_window_idx
  on ideas (capture_mode, opens_at, closes_at)
  where active;

create table submission_media (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references captures (id) on delete cascade,
  media_type    prompt_media_type not null,
  bucket        text not null,
  storage_key   text not null unique,
  sort_order    integer not null,
  width         integer,
  height        integer,
  duration      numeric(8, 2),
  mime_type     text,
  file_size     bigint,
  created_at    timestamptz not null default now(),
  unique (submission_id, sort_order),
  check (sort_order >= 0),
  check (width is null or width > 0),
  check (height is null or height > 0),
  check (duration is null or duration >= 0),
  check (file_size is null or file_size > 0)
);

create index submission_media_submission_idx
  on submission_media (submission_id, sort_order);

-- Existing rows become one-media submissions without changing their IDs or
-- object paths.
insert into submission_media (
  submission_id, media_type, bucket, storage_key, sort_order,
  width, height, duration, mime_type, file_size, created_at)
select id,
       case kind when 'photo' then 'PHOTO'::prompt_media_type
                 else 'VIDEO'::prompt_media_type end,
       bucket, storage_key, 0,
       width, height, duration_s, mime, master_bytes, created_at
  from captures
on conflict (submission_id, sort_order) do nothing;

-- Existing clients create the envelope and its first object in one insert.
-- Mirror that object into the normalized table until the client switches to a
-- separate media-reservation call in Phase 2.
create or replace function mirror_capture_primary_media()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into submission_media (
    submission_id, media_type, bucket, storage_key, sort_order,
    width, height, duration, mime_type, file_size, created_at)
  values (
    new.id,
    case new.kind when 'photo' then 'PHOTO'::prompt_media_type
                  else 'VIDEO'::prompt_media_type end,
    new.bucket, new.storage_key, 0,
    new.width, new.height, new.duration_s, new.mime, new.master_bytes, new.created_at)
  on conflict (submission_id, sort_order) do nothing;
  return new;
end;
$$;

create trigger captures_mirror_primary_media
  after insert on captures
  for each row execute function mirror_capture_primary_media();

alter table submission_media enable row level security;

create policy submission_media_read on submission_media for select
  using (exists (
    select 1 from captures c
     where c.id = submission_id
       and (c.person_id = app_current_person_id()
            or (app_is_staff() and c.org_id = app_current_org_id()))));

create policy submission_media_insert_own on submission_media for insert
  with check (exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = app_current_person_id()
       and c.state = 'uploading'));

create policy submission_media_update_own on submission_media for update
  using (exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = app_current_person_id()
       and c.state = 'uploading'))
  with check (exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = app_current_person_id()
       and c.state = 'uploading'));

create policy submission_media_delete_own on submission_media for delete
  using (exists (
    select 1 from captures c
     where c.id = submission_id
       and c.person_id = app_current_person_id()
       and c.state = 'uploading'));

grant select, insert, update, delete on submission_media to authenticated;
revoke all on submission_media from anon;
revoke execute on function mirror_capture_primary_media() from public, anon, authenticated;
