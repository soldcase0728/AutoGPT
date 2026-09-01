\pset tuples_only on
\pset format unaligned

-- Row level security, checked from the seat of an actual signed-in student.

-- Signing in claims the roster row that matches the address.
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-0000000000a1', 'ali@example.edu'),
  ('d0000000-0000-0000-0000-0000000000b2', 'jo@example.edu');

select t_assert((select auth_user_id from people
                  where id = '63333333-3333-3333-3333-333333333333')
                = 'd0000000-0000-0000-0000-0000000000a1',
                'first sign-in should claim the matching roster row');

-- Someone who authenticates without a roster row gets no profile at all.
insert into auth.users (id, email)
values ('d0000000-0000-0000-0000-0000000000c3', 'stranger@example.edu');

select t_assert(not exists (select 1 from people
                             where auth_user_id = 'd0000000-0000-0000-0000-0000000000c3'),
                'an address that is not on the roster should not get a profile');

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);

  select t_assert(app_current_person_id() = '63333333-3333-3333-3333-333333333333',
                  'the helper should resolve the signed-in student');

  select t_assert(not app_is_staff(), 'a student is not staff');

  select t_assert(exists (select 1 from captures
                           where id = 'c0000000-0000-0000-0000-000000000001'),
                  'a student should see their own capture');

  select t_assert(not exists (select 1 from captures
                               where id = 'c0000000-0000-0000-0000-000000000004'),
                  'a student must not see another student''s capture');

  select t_assert((select count(*) from consents) = 3,
                  'a student should only see their own consent records');

  -- A student cannot file a capture under someone else's name.
  do $$
  begin
    begin
      insert into captures (assignment_id, person_id, org_id, bucket, storage_key)
      values ('a0000000-0000-0000-0000-000000000004',
              '64444444-4444-4444-4444-444444444444',
              '11111111-1111-1111-1111-111111111111',
              'captures', 'jo/forged/clip.mp4');
      raise exception 'ASSERT FAILED: student should not insert for another person';
    exception
      when insufficient_privilege then null;  -- expected
    end;
  end $$;
rollback;

-- A reviewer sees the whole org queue.
insert into auth.users (id, email)
values ('d0000000-0000-0000-0000-0000000000d4', 'social@example.edu');

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);

  select t_assert(app_is_staff(), 'the marketing desk is staff');
  select t_assert((select count(*) from review_queue) = 5,
                  'a reviewer should see every capture in their org');
  select t_assert(not app_is_admin(), 'a reviewer is not an admin');
rollback;
