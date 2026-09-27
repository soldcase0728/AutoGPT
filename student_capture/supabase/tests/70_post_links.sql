\pset tuples_only on
\pset format unaligned

-- Post links: staff-only, https-only, and only on posted captures.

insert into assignments (id, idea_id, person_id, due_on) values
  ('b7000000-0000-0000-0000-000000000001',
   '51111111-1111-1111-1111-111111111111',
   '63333333-3333-3333-3333-333333333333', current_date + 70);

-- Fixtures go in with triggers off: this file tests the link, not the
-- publication gate that 10_consent_gate.sql already covers.
set session_replication_role = replica;
insert into captures (
  id, assignment_id, person_id, org_id, prompt_id, media_type, bucket, storage_key, state, client_submission_id
) values
  ('c7000000-0000-0000-0000-000000000001',
   'b7000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111', 'video',
   'captures', '63333333-3333-3333-3333-333333333333/c700/posted.mp4',
   'published', '17000000-0000-4000-8000-000000000001'),
  ('c7000000-0000-0000-0000-000000000002',
   'b7000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111', 'video',
   'captures', '63333333-3333-3333-3333-333333333333/c700/uploading.mp4',
   'uploading', '17000000-0000-4000-8000-000000000002');
set session_replication_role = origin;

-- Staff can set a link on a posted capture, and it is audited.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select set_capture_post_url('c7000000-0000-0000-0000-000000000001',
                              '  https://www.instagram.com/p/abc123/  ');
commit;

select t_assert(
  (select post_url = 'https://www.instagram.com/p/abc123/'
     from captures where id = 'c7000000-0000-0000-0000-000000000001'),
  'staff should be able to set a trimmed post link on a posted capture');
select t_assert(
  exists (select 1 from audit_log where action = 'capture.post_url'
           and subject_id = 'c7000000-0000-0000-0000-000000000001'),
  'setting a post link should be audited');

-- Not an https address.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
    perform set_capture_post_url('c7000000-0000-0000-0000-000000000001', 'javascript:alert(1)');
    raise exception 'ASSERT FAILED: a non-https post link was accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- Not posted yet.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
    perform set_capture_post_url('c7000000-0000-0000-0000-000000000002', 'https://example.com/p/1');
    raise exception 'ASSERT FAILED: a link was accepted on a capture that is not posted';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- A student cannot set a link, through the function or by writing the column
-- on their own uploading capture.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
    perform set_capture_post_url('c7000000-0000-0000-0000-000000000001', 'https://example.com/fake');
    raise exception 'ASSERT FAILED: a student set a post link through the function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
    update captures set post_url = 'https://example.com/fake'
     where id = 'c7000000-0000-0000-0000-000000000002';
    raise exception 'ASSERT FAILED: a student wrote post_url directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select t_assert(
  (select post_url is null from captures where id = 'c7000000-0000-0000-0000-000000000002'),
  'a student-written post link must not persist');

-- Staff can clear a link.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select set_capture_post_url('c7000000-0000-0000-0000-000000000001', '');
commit;

select t_assert(
  (select post_url is null from captures where id = 'c7000000-0000-0000-0000-000000000001'),
  'an empty link should clear the post link');
