-- Store prompt rules as first-class fields and persist the resulting media
-- type/orientation on each submission.

alter table ideas rename column required_orientation to orientation;
alter table ideas
  add column min_duration_seconds numeric(8, 2),
  add column max_duration_seconds numeric(8, 2),
  add column caption_required boolean not null default false;

update ideas
   set min_duration_seconds = nullif(format_spec->>'min_seconds', '')::numeric,
       max_duration_seconds = nullif(format_spec->>'max_seconds', '')::numeric;

alter table ideas
  drop constraint ideas_media_count_check,
  add constraint ideas_media_count_check check (
    (media_type in ('video', 'photo') and min_media_count = 1 and max_media_count = 1)
    or (media_type = 'photo_series'
        and min_media_count between 1 and 4
        and max_media_count between min_media_count and 4)),
  add constraint ideas_duration_check check (
    (min_duration_seconds is null or min_duration_seconds >= 0)
    and (max_duration_seconds is null or max_duration_seconds > 0)
    and (min_duration_seconds is null or max_duration_seconds is null
         or min_duration_seconds <= max_duration_seconds)),
  drop constraint ideas_photo_formats_check,
  add constraint ideas_photo_formats_check check (
    media_type = 'video' or coalesce(cardinality(allowed_image_formats), 0) > 0);

alter table captures
  add column media_type prompt_media_type,
  add column orientation prompt_orientation;

update captures c
   set media_type = i.media_type
  from ideas i
 where i.id = c.prompt_id;

alter table captures alter column media_type set not null;

create or replace function mirror_capture_primary_media()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into submission_media (
    submission_id, media_type, bucket, storage_key, sort_order,
    width, height, duration, mime_type, file_size, created_at)
  values (
    new.id,
    case new.kind when 'photo' then 'photo'::prompt_media_type
                  else 'video'::prompt_media_type end,
    new.bucket, new.storage_key, 0,
    new.width, new.height, new.duration_s, new.mime, new.master_bytes, new.created_at)
  on conflict (submission_id, sort_order) do nothing;
  return new;
end;
$$;

-- Keep assigned/open prompt integrity in one trigger and copy the immutable
-- rule identity onto new submissions for filtering and audit history.
create or replace function enforce_capture_prompt_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assignment assignments;
  v_mode prompt_capture_mode;
  v_prompt_org uuid;
  v_media_type prompt_media_type;
begin
  if new.assignment_id is not null then
    select * into v_assignment from assignments where id = new.assignment_id;
    if not found then raise exception 'assignment does not exist'; end if;
    if new.prompt_id is null then new.prompt_id := v_assignment.idea_id; end if;
    if new.prompt_id <> v_assignment.idea_id or new.person_id <> v_assignment.person_id then
      raise exception 'submission does not match its assignment';
    end if;
  elsif new.prompt_id is null then
    raise exception 'submission requires a prompt';
  end if;

  select i.capture_mode, cam.org_id, i.media_type
    into v_mode, v_prompt_org, v_media_type
    from ideas i join campaigns cam on cam.id = i.campaign_id
   where i.id = new.prompt_id;
  if not found or v_prompt_org <> new.org_id then
    raise exception 'submission prompt does not belong to its organization';
  end if;
  if new.assignment_id is null and v_mode <> 'OPEN_MOMENT' then
    raise exception 'assigned prompt requires an assignment';
  end if;
  if new.media_type is null then new.media_type := v_media_type; end if;
  if new.media_type <> v_media_type then
    raise exception 'submission media type does not match its prompt';
  end if;
  return new;
end;
$$;

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
       ), '[]'::jsonb) as media_items
  from captures c
  join people p       on p.id   = c.person_id
  join ideas i        on i.id   = c.prompt_id
  join campaigns cam  on cam.id = i.campaign_id
  left join capture_context ctx on ctx.capture_id = c.id;
