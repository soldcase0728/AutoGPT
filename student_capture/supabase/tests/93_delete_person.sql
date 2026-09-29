\pset tuples_only on
\pset format unaligned

-- Deleting someone from the roster: only an admin, never themselves, never
-- with posted shots, never someone with a record on the desk, and shots only
-- when the admin said so.

create or replace function pg_temp.try_delete(p_sub uuid, p_person uuid, p_with boolean) returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  v := delete_person(p_person, p_with);
  reset role;
  return 'ok:' || (v->>'shots_deleted');
exception when others then
  reset role;
  return sqlstate || ':' || sqlerrm;
end $$;

begin;
-- A new student with nothing sent, and a second admin to act as.
insert into people (id, org_id, role, display_name, email, participation) values
  ('6d000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'student', 'Mistake Entry', 'mistake@example.edu', 'active');
insert into assignments (idea_id, person_id, due_on)
  select id, '6d000000-0000-0000-0000-000000000001', current_date from ideas limit 1;

select t_assert(pg_temp.try_delete('d0000000-0000-0000-0000-0000000000d4', '6d000000-0000-0000-0000-000000000001', false) like '42501:%',
  'a reviewer should not be able to delete people');
select t_assert(pg_temp.try_delete('d9000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', false) like '23514:%',
  'an admin should not be able to delete themselves');
select t_assert(pg_temp.try_delete('d9000000-0000-0000-0000-000000000001', '6d000000-0000-0000-0000-000000000001', false) = 'ok:0',
  'an admin should be able to delete someone with nothing sent');
select t_assert(not exists (select 1 from people where id = '6d000000-0000-0000-0000-000000000001')
  and not exists (select 1 from assignments where person_id = '6d000000-0000-0000-0000-000000000001'),
  'the person and their assignments should be gone');
select t_assert(exists (select 1 from audit_log where action = 'person.deleted' and subject_id = '6d000000-0000-0000-0000-000000000001'),
  'the delete should be audited');

-- Ali has a posted shot (c7…01 from 70_post_links.sql): refused.
select t_assert(pg_temp.try_delete('d9000000-0000-0000-0000-000000000001', '63333333-3333-3333-3333-333333333333', true) like '23514:%posted%',
  'someone with a posted shot should not be deletable');

-- Once nothing is posted, deleting Ali needs the shots confirmed.
set local session_replication_role = replica;
update captures set state = 'approved' where person_id = '63333333-3333-3333-3333-333333333333' and state = 'published';
set local session_replication_role = origin;
select t_assert(pg_temp.try_delete('d9000000-0000-0000-0000-000000000001', '63333333-3333-3333-3333-333333333333', false) like '23514:They have sent%',
  'deleting someone with shots should need the shots confirmed');

select t_assert(pg_temp.try_delete('d9000000-0000-0000-0000-000000000001', '63333333-3333-3333-3333-333333333333', true) like 'ok:%',
  'with the shots confirmed, the student and their shots should be deleted');
select t_assert(not exists (select 1 from captures where person_id = '63333333-3333-3333-3333-333333333333'),
  'their shots should be gone');

-- The marketing desk reviewer has reviews on record: the foreign keys refuse it.
select t_assert(pg_temp.try_delete('d9000000-0000-0000-0000-000000000001', '62222222-2222-2222-2222-222222222222', false) like '23503:%',
  'someone with a record on the desk should not be deletable');
rollback;
