\pset tuples_only on
\pset format unaligned

-- Shot of the Day: admins award it, one per school per day, only to accepted
-- shots; the student who shot it can see it, other students can't.

create or replace function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
end $$;

-- An uploading capture of Ali's (from 70_post_links.sql) can't win.
do $$
begin
  begin
    perform pg_temp.as_user('d9000000-0000-0000-0000-000000000001');
    perform award_shot_of_the_day('c7000000-0000-0000-0000-000000000002', current_date, null);
    raise exception 'ASSERT FAILED: an unsent capture won Shot of the Day';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- A reviewer can't award it.
do $$
begin
  begin
    perform pg_temp.as_user('d0000000-0000-0000-0000-0000000000d4');
    perform award_shot_of_the_day('c7000000-0000-0000-0000-000000000001', current_date, null);
    raise exception 'ASSERT FAILED: a reviewer awarded Shot of the Day';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Nor a date outside the last week.
do $$
begin
  begin
    perform pg_temp.as_user('d9000000-0000-0000-0000-000000000001');
    perform award_shot_of_the_day('c7000000-0000-0000-0000-000000000001', current_date - 30, null);
    raise exception 'ASSERT FAILED: an old date was accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- The admin awards Ali's posted capture.
begin;
select pg_temp.as_user('d9000000-0000-0000-0000-000000000001');
select award_shot_of_the_day('c7000000-0000-0000-0000-000000000001', current_date, '  Great light.  ');
reset role;
commit;

select t_assert(
  (select note = 'Great light.' and awarded_on = current_date from shot_awards
    where capture_id = 'c7000000-0000-0000-0000-000000000001'),
  'the award should be stored with a trimmed note');
select t_assert(
  exists (select 1 from audit_log where action = 'capture.shot_of_the_day'),
  'awarding should be audited');

-- Ali sees it; Jo doesn't.
begin;
select pg_temp.as_user('d0000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) = 1 from shot_awards), 'the winning student should see their award');
reset role;
commit;
begin;
select pg_temp.as_user('d0000000-0000-0000-0000-0000000000b2');
select t_assert((select count(*) = 0 from shot_awards), 'another student should not see it');
reset role;
commit;

-- Students can't write awards directly.
do $$
begin
  begin
    perform pg_temp.as_user('d0000000-0000-0000-0000-0000000000a1');
    insert into shot_awards (org_id, capture_id, awarded_on, awarded_by)
    values ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000001',
            current_date - 1, '63333333-3333-3333-3333-333333333333');
    raise exception 'ASSERT FAILED: a student wrote an award';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Awarding again for the same day replaces the pick; removing clears it.
begin;
select pg_temp.as_user('d9000000-0000-0000-0000-000000000001');
select award_shot_of_the_day('c7000000-0000-0000-0000-000000000001', current_date, null);
reset role;
commit;
select t_assert(
  (select count(*) = 1 and bool_and(note is null) from shot_awards where awarded_on = current_date),
  'a second pick for the same day should replace the first');

begin;
select pg_temp.as_user('d9000000-0000-0000-0000-000000000001');
select remove_shot_of_the_day((select id from shot_awards where awarded_on = current_date));
reset role;
commit;
select t_assert(
  not exists (select 1 from shot_awards where awarded_on = current_date),
  'removing should clear the day');
