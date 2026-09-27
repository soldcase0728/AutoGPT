\pset tuples_only on
\pset format unaligned

-- Student messages and internal notes stay apart; takedowns tell the student.

insert into assignments (id, idea_id, person_id, due_on) values
  ('b8000000-0000-0000-0000-000000000001',
   '51111111-1111-1111-1111-111111111111',
   '63333333-3333-3333-3333-333333333333', current_date + 80);

set session_replication_role = replica;
insert into captures (
  id, assignment_id, person_id, org_id, prompt_id, media_type, bucket, storage_key,
  state, client_submission_id
) values
  ('c8000000-0000-0000-0000-000000000001',
   'b8000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111', 'video',
   'captures', '63333333-3333-3333-3333-333333333333/c800/a.mp4',
   'in_review', '18000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-0000-0000-000000000002',
   'b8000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111', 'video',
   'captures', '63333333-3333-3333-3333-333333333333/c800/b.mp4',
   'published', '18000000-0000-4000-8000-000000000002');
set session_replication_role = origin;

-- The reviewer rejects with a message and a private note.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select review_capture('c8000000-0000-0000-0000-000000000001', 'rejected',
                        'Too dark to use. Try near a window.', 'Third dark one this week.');
commit;

select t_assert(
  (select note = 'Too dark to use. Try near a window.' from reviews
    where capture_id = 'c8000000-0000-0000-0000-000000000001'),
  'the student message should be stored on the review');
select t_assert(
  (select note = 'Third dark one this week.' and review_id is not null from review_internal_notes
    where capture_id = 'c8000000-0000-0000-0000-000000000001'),
  'the internal note should be stored separately, linked to its review');

-- The student can read the message but not the internal note.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  select t_assert(
    (select count(*) = 1 from reviews where capture_id = 'c8000000-0000-0000-0000-000000000001'),
    'the student should read the review message');
  select t_assert(
    (select count(*) = 0 from review_internal_notes),
    'the student must not read internal notes');
commit;

-- Students cannot write internal notes directly.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
    insert into review_internal_notes (capture_id, org_id, author_id, note)
    values ('c8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            '63333333-3333-3333-3333-333333333333', 'forged');
    raise exception 'ASSERT FAILED: a student wrote an internal note';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A takedown records the reason internally and gives the student a message.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select take_down_capture('c8000000-0000-0000-0000-000000000002',
                           'Parent called the office',
                           'We took this down at a family''s request. Nothing you did wrong.');
commit;

select t_assert(
  (select state = 'rejected' and takedown_at is not null
     from captures where id = 'c8000000-0000-0000-0000-000000000002'),
  'takedown should reject and stamp the capture');
select t_assert(
  (select note like 'We took this down%' from reviews
    where capture_id = 'c8000000-0000-0000-0000-000000000002'),
  'takedown should leave a message the student can read');
select t_assert(
  (select note = 'Taken down: Parent called the office' from review_internal_notes
    where capture_id = 'c8000000-0000-0000-0000-000000000002'),
  'takedown reason should stay internal');
