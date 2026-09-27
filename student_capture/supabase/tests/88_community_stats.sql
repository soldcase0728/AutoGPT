\pset tuples_only on
\pset format unaligned

-- Community stats: counts only, own organisation only, and a group total only
-- for its members once the group has at least 5 of them.

create or replace function pg_temp.stats_as(p_sub uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  v := my_community_stats();
  reset role;
  return v;
end $$;

-- Ali (from 20_rls.sql) is the only member of Varsity soccer (from 85_groups.sql).
begin;
select t_assert(
  jsonb_array_length(pg_temp.stats_as('d0000000-0000-0000-0000-0000000000a1')->'groups') = 0,
  'a group smaller than 5 should not be reported');
commit;

insert into people (id, org_id, role, display_name, email, participation) values
  ('68800000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'student', 'Team Two', 'team2@example.edu', 'active'),
  ('68800000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'student', 'Team Three', 'team3@example.edu', 'active'),
  ('68800000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'student', 'Team Four', 'team4@example.edu', 'active'),
  ('68800000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'student', 'Team Five', 'team5@example.edu', 'active');
insert into student_group_members (group_id, person_id)
select '9a000000-0000-0000-0000-000000000001', id from people where id::text like '68800000-%';

create temp table before_stats as
  select pg_temp.stats_as('d0000000-0000-0000-0000-0000000000a1') as s;
reset role;

select t_assert(
  (select (s->'groups'->0->>'members')::int = 5 and s->'groups'->0->>'name' = 'Varsity soccer' from before_stats),
  'a member should see their group once it has 5 members');

-- One teammate sends something now; another school posts something.
set session_replication_role = replica;
insert into captures (
  id, person_id, org_id, prompt_id, media_type, bucket, storage_key, state, client_submission_id, submitted_at
) values
  ('c8800000-0000-0000-0000-000000000001',
   '68800000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '51111111-1111-1111-1111-111111111111', 'photo',
   'captures', '68800000-0000-0000-0000-000000000001/c880/sent.jpg',
   'submitted', '18800000-0000-4000-8000-000000000001', now()),
  ('c8800000-0000-0000-0000-000000000002',
   '69000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001',
   '51111111-1111-1111-1111-111111111111', 'photo',
   'captures', '69000000-0000-0000-0000-000000000002/c880/elsewhere.jpg',
   'published', '18800000-0000-4000-8000-000000000002', now());
set session_replication_role = origin;

create temp table after_stats as
  select pg_temp.stats_as('d0000000-0000-0000-0000-0000000000a1') as s;
reset role;

select t_assert(
  (select (a.s->'groups'->0->>'week_sent')::int = (b.s->'groups'->0->>'week_sent')::int + 1
     from after_stats a, before_stats b),
  'a teammate sending something should count toward the group');
select t_assert(
  (select (a.s->>'week_contributors')::int = (b.s->>'week_contributors')::int + 1
     from after_stats a, before_stats b),
  'a new sender should count as a contributor');
select t_assert(
  (select (a.s->>'week_posted')::int = (b.s->>'week_posted')::int
     from after_stats a, before_stats b),
  'another organisation''s posts should not count');

-- Someone outside the group sees no group total.
begin;
select t_assert(
  jsonb_array_length(pg_temp.stats_as('d9000000-0000-0000-0000-000000000001')->'groups') = 0,
  'a non-member should not see the group');
commit;

-- Not callable without signing in.
do $$
begin
  begin
    set local role anon;
    perform my_community_stats();
    raise exception 'ASSERT FAILED: anon ran my_community_stats';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
