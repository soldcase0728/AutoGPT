\pset tuples_only on
\pset format unaligned

-- Student groups: admins write, staff read, students see nothing; members stay in-org.

insert into people (id, org_id, role, display_name, email, participation) values
  ('69000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'admin', 'Group Admin', 'group-admin@example.edu', 'active');
insert into auth.users (id, email) values
  ('d9000000-0000-0000-0000-000000000001', 'group-admin@example.edu');

insert into organizations (id, name, slug) values
  ('19000000-0000-0000-0000-000000000001', 'Elsewhere', 'elsewhere');
insert into people (id, org_id, role, display_name, email) values
  ('69000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001',
   'student', 'Outsider', 'outsider@example.edu');

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', true);
  insert into student_groups (id, org_id, name, kind) values
    ('9a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Varsity soccer', 'team');
  insert into student_group_members (group_id, person_id) values
    ('9a000000-0000-0000-0000-000000000001', '63333333-3333-3333-3333-333333333333');
commit;

select t_assert(
  (select count(*) = 1 from student_group_members where group_id = '9a000000-0000-0000-0000-000000000001'),
  'an admin should create a group and add a member');

-- A person from another organisation cannot be added.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', true);
    insert into student_group_members (group_id, person_id) values
      ('9a000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000002');
    raise exception 'ASSERT FAILED: a member from another organisation was added';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A reviewer reads groups; a student sees none and cannot create one.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select t_assert((select count(*) = 1 from student_groups), 'staff should read groups');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  select t_assert((select count(*) = 0 from student_groups), 'students must not read groups');
commit;

do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
    insert into student_groups (org_id, name) values ('11111111-1111-1111-1111-111111111111', 'Mine');
    raise exception 'ASSERT FAILED: a student created a group';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
