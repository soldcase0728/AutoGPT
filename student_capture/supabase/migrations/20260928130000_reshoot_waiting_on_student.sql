-- A shot sent back for a reshoot stays on the desk as "Waiting on student"
-- until the new take is sent, then returns to "To review" as the same item.
--
-- Starting a reshoot moves the capture back to `uploading` (the student needs
-- that to upload the new take). Hiding drafts from staff also hid these, so
-- the item vanished from the desk while the student was reshooting. Staff now
-- see a capture being reshot (media_revision > 1), but only the take they
-- already had: the new take's files stay the student's until it is sent.

drop policy if exists captures_read on captures;
create policy captures_read on captures for select
  using (person_id = app_current_person_id()
         or (app_is_staff() and org_id = app_current_org_id()
             and (state <> 'uploading' or media_revision > 1)));

drop policy if exists submission_media_read on submission_media;
create policy submission_media_read on submission_media for select
  using (exists (
    select 1 from captures c
     where c.id = submission_id
       and (c.person_id = app_current_person_id()
            or (app_is_staff() and c.org_id = app_current_org_id()
                and (c.state <> 'uploading' or submission_media.media_revision < c.media_revision)))));

-- The queue shows the returned take while a reshoot is in progress, and says
-- which take it is.
create or replace view review_queue
with (security_invoker = true) as
 SELECT c.id,
    c.org_id,
    c.person_id,
    p.display_name AS student,
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
    i.id AS idea_id,
    i.title AS idea_title,
    i.brief AS idea_brief,
    i.format_spec,
    cam.name AS campaign_name,
    capture_consent_blockers(c.id) AS consent_blockers,
    c.media_type,
    c.orientation,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', sm.id, 'sort_order', sm.sort_order, 'width', sm.width, 'height', sm.height, 'mime_type', sm.mime_type, 'file_size', sm.file_size) ORDER BY sm.sort_order) AS jsonb_agg
           FROM submission_media sm
          WHERE sm.submission_id = c.id
            AND sm.media_revision = CASE WHEN c.state = 'uploading' THEN c.media_revision - 1 ELSE c.media_revision END), '[]'::jsonb) AS media_items,
    c.state_changed_at,
    c.review_started_at,
    c.review_started_by,
    c.withdrawn_at,
    c.retention_due_at,
    p.participation AS student_participation,
    c.media_revision
   FROM captures c
     JOIN people p ON p.id = c.person_id
     JOIN ideas i ON i.id = c.prompt_id
     JOIN campaigns cam ON cam.id = i.campaign_id
     LEFT JOIN capture_context ctx ON ctx.capture_id = c.id;
