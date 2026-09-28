\pset tuples_only on
\pset format unaligned

-- Staff can't see a shot the student hasn't sent; the student can.

create or replace function pg_temp.count_as(p_sub uuid, p_capture uuid) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  select count(*) into n from captures where id = p_capture;
  reset role;
  return n;
end $$;

-- c7…02 (from 70_post_links.sql) is Ali's upload that was never sent.
begin;
select t_assert(pg_temp.count_as('d0000000-0000-0000-0000-0000000000d4', 'c7000000-0000-0000-0000-000000000002') = 0,
  'a reviewer should not see an unsent draft');
select t_assert(pg_temp.count_as('d9000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002') = 0,
  'an admin should not see an unsent draft');
select t_assert(pg_temp.count_as('d0000000-0000-0000-0000-0000000000a1', 'c7000000-0000-0000-0000-000000000002') = 1,
  'the student should still see their own draft');
select t_assert(pg_temp.count_as('d0000000-0000-0000-0000-0000000000d4', 'c7000000-0000-0000-0000-000000000001') = 1,
  'staff should still see a sent shot');
commit;
