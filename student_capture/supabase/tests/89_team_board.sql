\pset tuples_only on
\pset format unaligned

-- The team board: nobody appears until they opt themselves in, only first
-- names show, only teammates see it, and staff can't opt a student in.

create or replace function pg_temp.board_as(p_sub uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  v := my_team_board();
  reset role;
  return v;
end $$;

create or replace function pg_temp.opt_in_as(p_sub uuid, p_show boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  perform set_board_opt_in(p_show);
  reset role;
end $$;

-- A teammate of Ali's (from 88_community_stats.sql) with a login.
insert into auth.users (id, email) values ('d8900000-0000-0000-0000-000000000001', 'team2@example.edu');
update people set auth_user_id = 'd8900000-0000-0000-0000-000000000001'
 where id = '68800000-0000-0000-0000-000000000001';

begin;
select t_assert(
  (select b->>'opted_in' = 'false'
          and jsonb_array_length(b->'groups'->0->'entries') = 0
     from (select pg_temp.board_as('d0000000-0000-0000-0000-0000000000a1') b) x),
  'nobody should be on the board before opting in');
commit;

begin;
select pg_temp.opt_in_as('d0000000-0000-0000-0000-0000000000a1', true);
commit;

begin;
select t_assert(
  (select b->>'opted_in' = 'true'
          and b->'groups'->0->'entries' @> '[{"first_name": "Ali", "me": true}]'::jsonb
          and jsonb_array_length(b->'groups'->0->'entries') = 1
     from (select pg_temp.board_as('d0000000-0000-0000-0000-0000000000a1') b) x),
  'after opting in, a student should see themself by first name only');
select t_assert(
  (select b->'groups'->0->'entries' @> '[{"first_name": "Ali", "me": false}]'::jsonb
     from (select pg_temp.board_as('d8900000-0000-0000-0000-000000000001') b) x),
  'a teammate should see an opted-in student');
select t_assert(
  (select b::text not like '%Haddad%'
     from (select pg_temp.board_as('d8900000-0000-0000-0000-000000000001') b) x),
  'the board should never carry a last name');
commit;

-- The teammate hasn't opted in, so Ali doesn't see them; a sent capture counts once they do.
begin;
select pg_temp.opt_in_as('d8900000-0000-0000-0000-000000000001', true);
commit;
begin;
select t_assert(
  (select (e->>'week_sent')::int >= 1
     from (select pg_temp.board_as('d0000000-0000-0000-0000-0000000000a1') b) x,
          jsonb_array_elements(x.b->'groups'->0->'entries') e
    where e->>'first_name' = 'Team'),
  'an opted-in teammate should show with this week''s count');
commit;

-- Opting out takes them straight off.
begin;
select pg_temp.opt_in_as('d8900000-0000-0000-0000-000000000001', false);
commit;
begin;
select t_assert(
  (select not (b->'groups'->0->'entries' @> '[{"first_name": "Team"}]'::jsonb)
     from (select pg_temp.board_as('d0000000-0000-0000-0000-0000000000a1') b) x),
  'opting out should take a student off the board');
commit;

-- Staff can't opt anyone in, and can't read or write the table directly.
do $$
begin
  begin
    perform set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', true);
    set local role authenticated;
    perform set_board_opt_in(true);
    raise exception 'ASSERT FAILED: an admin used set_board_opt_in';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  begin
    perform set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', true);
    set local role authenticated;
    insert into board_opt_ins (person_id) values ('63333333-3333-3333-3333-333333333333');
    raise exception 'ASSERT FAILED: board_opt_ins was writable directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Someone in no group sees no board.
begin;
select t_assert(
  (select jsonb_array_length(b->'groups') = 0
     from (select pg_temp.board_as('d9000000-0000-0000-0000-000000000001') b) x),
  'a person in no group should see no board');
commit;

select t_assert(
  exists (select 1 from audit_log where action = 'person.board_opt_in'),
  'opting in should be audited');
