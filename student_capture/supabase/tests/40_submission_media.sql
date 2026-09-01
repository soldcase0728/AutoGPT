\pset tuples_only on
\pset format unaligned

-- Phase 1 prompt normalization and relational media behavior.

select t_assert(
  (select media_type = 'photo'
          and orientation = 'any'
          and min_media_count = 1
          and max_media_count = 1
     from ideas where id = '56666666-6666-6666-6666-666666666666'),
  'legacy photo prompts should be normalized without changing format_spec');

select t_assert(
  not exists (
    select 1 from captures c
    where not exists (
      select 1 from submission_media sm
       where sm.submission_id = c.id
         and sm.sort_order = 0
         and sm.storage_key = c.storage_key)),
  'every capture insert should mirror its primary object into submission_media');

select t_assert(
  not exists (
    select 1 from captures c
    join assignments a on a.id = c.assignment_id
    where c.prompt_id <> a.idea_id),
  'assigned submissions should link directly to the same prompt as their assignment');

-- Open Moments use the same submission envelope without a fabricated
-- assignment, which is the database contract the Phase 2 UI will consume.
begin;
  insert into ideas (
    id, campaign_id, title, brief, format_spec, capture_mode, media_type,
    orientation, allowed_image_formats
  ) values (
    '57777777-7777-7777-7777-777777777777',
    '41111111-1111-1111-1111-111111111111',
    'Open verification moment', 'Transaction-only fixture',
    '{"kind":"photo","orientation":"any"}',
    'OPEN_MOMENT', 'photo', 'any', array['image/jpeg']
  );
  insert into captures (
    id, prompt_id, person_id, org_id, bucket, storage_key, kind
  ) values (
    'c7000000-0000-0000-0000-000000000001',
    '57777777-7777-7777-7777-777777777777',
    '63333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'captures', 'ali/open/photo.jpg', 'photo'
  );
  select t_assert(
    (select assignment_id is null and prompt_id = '57777777-7777-7777-7777-777777777777'
       from captures where id = 'c7000000-0000-0000-0000-000000000001'),
    'an Open Moment submission should not require an assignment');
rollback;

-- An active owner may add and edit media only while the envelope is uploading.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);

  insert into submission_media (
    id, submission_id, media_type, bucket, storage_key, sort_order, mime_type, file_size
  ) values (
    'f1000000-0000-0000-0000-000000000002',
    'f0000000-0000-0000-0000-000000000001',
    'video', 'captures', 'kit/f1/media-2/clip.mp4', 1, 'video/mp4', 1234
  );

  update submission_media set width = 1080, height = 1920
   where id = 'f1000000-0000-0000-0000-000000000002';

  select t_assert(
    (select width = 1080 and height = 1920 from submission_media
      where id = 'f1000000-0000-0000-0000-000000000002'),
    'the owner should be able to add and update media while uploading');
rollback;

-- A student cannot attach media to another student's submission.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',
                       'd0000000-0000-0000-0000-0000000000b2', true);
    insert into submission_media (
      submission_id, media_type, bucket, storage_key, sort_order
    ) values (
      'f0000000-0000-0000-0000-000000000001',
      'video', 'captures', 'jo/forged/clip.mp4', 1
    );
    raise exception 'ASSERT FAILED: student attached media to another submission';
  exception
    when insufficient_privilege then null;
  end;
  reset role;
end $$;
