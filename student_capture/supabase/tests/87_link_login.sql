\pset tuples_only on
\pset format unaligned

-- An admin can link a roster row to a login that already existed; nobody else can.

insert into auth.users (id, email) values
  ('d8700000-0000-0000-0000-000000000001', 'Late.Roster@example.edu');
insert into people (id, org_id, role, display_name, email) values
  ('68700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'student', 'Late Roster', 'late.roster@example.edu');

select t_assert(
  (select auth_user_id is null from people where id = '68700000-0000-0000-0000-000000000001'),
  'a roster row added after its login should start unlinked');

-- A student cannot link.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
    perform link_person_login('68700000-0000-0000-0000-000000000001');
    raise exception 'ASSERT FAILED: a student linked a login';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The admin (from 85_groups.sql) can, case-insensitively.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', true);
  select t_assert(
    link_person_login('68700000-0000-0000-0000-000000000001') = 'd8700000-0000-0000-0000-000000000001',
    'an admin should link the existing login');
  select t_assert(
    link_person_login('68700000-0000-0000-0000-000000000001') is null,
    'linking again should be a no-op');
commit;

select t_assert(
  (select auth_user_id = 'd8700000-0000-0000-0000-000000000001'
     from people where id = '68700000-0000-0000-0000-000000000001'),
  'the roster row should now point at the login');
