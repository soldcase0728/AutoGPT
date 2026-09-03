\pset tuples_only on
\pset format unaligned

-- Automated safety is independent from human review but mandatory for posting.

update safety_jobs set status = 'cancelled', completed_at = now()
 where status in ('pending', 'processing');
update safety_screens set status = 'cancelled', cancelled_at = now(), completed_at = now()
 where status in ('pending', 'processing');

insert into assignments(id, idea_id, person_id, due_on) values
  ('a6000000-0000-0000-0000-000000000001',
   '51111111-1111-1111-1111-111111111111',
   '63333333-3333-3333-3333-333333333333', current_date + 60);

insert into captures(id, assignment_id, person_id, org_id, bucket, storage_key,
                     state, no_people_in_frame, client_submission_id)
values ('c6000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-000000000001',
        '63333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        'captures', '63333333-3333-3333-3333-333333333333/c600/clip.mp4',
        'uploading', true, '16000000-0000-4000-8000-000000000001');

update captures set state = 'submitted', submitted_at = now()
 where id = 'c6000000-0000-0000-0000-000000000001';

select t_assert(
  (select status = 'pending' from safety_screens
    where capture_id = 'c6000000-0000-0000-0000-000000000001')
  and (select count(*) = 1 from safety_jobs where safety_screen_id =
    (select id from safety_screens where capture_id = 'c6000000-0000-0000-0000-000000000001')),
  'submission should atomically create one pending screen and media job');

-- A student cannot read internal safety records.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  select t_assert((select count(*) from safety_screens
    where capture_id = 'c6000000-0000-0000-0000-000000000001') = 0,
    'student must not read safety screens');
  select t_assert((select count(*) from safety_findings) = 0,
    'student must not read safety findings');
rollback;

-- Same-organization staff can read them.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select t_assert((select count(*) from safety_screens
    where capture_id = 'c6000000-0000-0000-0000-000000000001') = 1,
    'reviewer should read same-organization safety screen');
rollback;

-- A leased job cannot be claimed twice.
create temporary table safety_claim as
select * from claim_safety_job(120);
select t_assert((select count(*) = 1 and lease_token is not null from safety_claim),
  'worker should claim and lease a job');
select t_assert((select id from claim_safety_job(120)) is null,
  'active lease should prevent a duplicate claim');

-- Human approval is allowed in parallel, but safety pending blocks posting.
update captures set state = 'in_review'
 where id = 'c6000000-0000-0000-0000-000000000001';
update captures set state = 'approved'
 where id = 'c6000000-0000-0000-0000-000000000001';
select t_assert(not capture_ready_to_post('c6000000-0000-0000-0000-000000000001'),
  'approval during processing must not become ready to post');

update safety_screens set status = 'no_flags', completed_at = now()
 where capture_id = 'c6000000-0000-0000-0000-000000000001';
select t_assert(capture_ready_to_post('c6000000-0000-0000-0000-000000000001'),
  'approved plus no flags plus consent should be ready to post');

-- Resubmission creates a new revision and cannot reuse an older clean screen.
update captures set state = 'changes_requested'
 where id = 'c6000000-0000-0000-0000-000000000001';
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  select begin_capture_resubmission('c6000000-0000-0000-0000-000000000001');
commit;
select t_assert((select state = 'uploading' and media_revision = 2 from captures
  where id = 'c6000000-0000-0000-0000-000000000001')
  and not capture_safety_ok('c6000000-0000-0000-0000-000000000001'),
  'new media revision must require a new screen');

-- Photo-series attribution uses stable submission_media IDs, never positions.
insert into submission_media(submission_id, media_revision, media_type, bucket,
                             storage_key, sort_order, mime_type, file_size)
values
 ('c6000000-0000-0000-0000-000000000001', 2, 'photo', 'captures',
  '63333333-3333-3333-3333-333333333333/c600/photo-1.jpg', 0, 'image/jpeg', 100),
 ('c6000000-0000-0000-0000-000000000001', 2, 'photo', 'captures',
  '63333333-3333-3333-3333-333333333333/c600/photo-2.jpg', 1, 'image/jpeg', 100);
update captures set state = 'submitted', media_type = 'photo_series'
 where id = 'c6000000-0000-0000-0000-000000000001';

insert into safety_findings(org_id, safety_screen_id, submission_media_id, category,
                            severity, confidence, description, detector)
select '11111111-1111-1111-1111-111111111111', s.id, sm.id, 'profanity_text',
       'high', 0.99, 'Visible profanity', 'test-provider'
  from safety_screens s join submission_media sm on sm.submission_id = s.capture_id
 where s.capture_id = 'c6000000-0000-0000-0000-000000000001'
   and s.media_revision = 2 and sm.media_revision = 2 and sm.sort_order = 1;
update safety_screens set status = 'flags_detected'
 where capture_id = 'c6000000-0000-0000-0000-000000000001' and media_revision = 2;
select t_assert((select sm.sort_order = 1 from safety_findings f
  join submission_media sm on sm.id = f.submission_media_id
  where f.safety_screen_id = (select id from safety_screens
    where capture_id = 'c6000000-0000-0000-0000-000000000001' and media_revision = 2)),
  'photo-series finding must reference exactly photo 2');

-- Withdrawal cancels work and does not report a provider failure.
update captures set state = 'withdrawn'
 where id = 'c6000000-0000-0000-0000-000000000001';
select t_assert((select status = 'cancelled' from safety_screens
  where capture_id = 'c6000000-0000-0000-0000-000000000001' and media_revision = 2),
  'withdrawal should cancel safety work');
