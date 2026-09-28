\pset tuples_only on
\pset format unaligned

-- A shot being reshot stays on the desk as "Waiting on student", showing the
-- take the desk already has; the new take stays the student's until it's sent.

create or replace function pg_temp.captures_as(p_sub uuid, p_capture uuid) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  select count(*) into n from captures where id = p_capture;
  reset role;
  return n;
end $$;

create or replace function pg_temp.media_as(p_sub uuid, p_capture uuid, p_revision int) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  select count(*) into n from submission_media where submission_id = p_capture and media_revision = p_revision;
  reset role;
  return n;
end $$;

create or replace function pg_temp.queue_revision_as(p_sub uuid, p_capture uuid) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  select count(*) into n from review_queue q, jsonb_array_elements(q.media_items) m
   where q.id = p_capture
     and exists (select 1 from submission_media sm where sm.id = (m->>'id')::uuid and sm.media_revision = 1);
  reset role;
  return n;
end $$;

-- c7…02 (from 70_post_links.sql) is Ali's unsent upload. Make it a reshoot in
-- progress: take 1 went to the desk, take 2 is on the student's phone.
begin;
set local session_replication_role = replica;
update captures set media_revision = 2 where id = 'c7000000-0000-0000-0000-000000000002';
delete from submission_media where submission_id = 'c7000000-0000-0000-0000-000000000002';
insert into submission_media(submission_id, media_revision, media_type, bucket, storage_key, sort_order, mime_type, file_size)
values
 ('c7000000-0000-0000-0000-000000000002', 1, 'video', 'captures',
  '63333333-3333-3333-3333-333333333333/c700/take-1.mp4', 0, 'video/mp4', 100000),
 ('c7000000-0000-0000-0000-000000000002', 2, 'video', 'captures',
  '63333333-3333-3333-3333-333333333333/c700/take-2.mp4', 0, 'video/mp4', 100000);
set local session_replication_role = origin;

select t_assert(pg_temp.captures_as('d0000000-0000-0000-0000-0000000000d4', 'c7000000-0000-0000-0000-000000000002') = 1,
  'a reviewer should still see a shot while it is being reshot');
select t_assert(pg_temp.media_as('d0000000-0000-0000-0000-0000000000d4', 'c7000000-0000-0000-0000-000000000002', 1) = 1,
  'a reviewer should see the take they sent back');
select t_assert(pg_temp.media_as('d0000000-0000-0000-0000-0000000000d4', 'c7000000-0000-0000-0000-000000000002', 2) = 0,
  'a reviewer should not see the new take before it is sent');
select t_assert(pg_temp.media_as('d0000000-0000-0000-0000-0000000000a1', 'c7000000-0000-0000-0000-000000000002', 2) = 1,
  'the student should see their new take');
select t_assert(pg_temp.queue_revision_as('d0000000-0000-0000-0000-0000000000d4', 'c7000000-0000-0000-0000-000000000002') = 1,
  'the queue should show the returned take while the reshoot is in progress');
rollback;
