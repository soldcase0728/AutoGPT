-- An administrator can delete someone from the roster: a mistake, a test
-- account, or a student leaving whose work the school doesn't keep.
--
-- One transaction, so it never half-happens. Refused when:
--   * it's the caller themselves;
--   * any of their shots is posted (take it down first);
--   * they're tagged in someone else's approved or posted shot (withdraw
--     their release first, which pulls those back);
--   * they sent shots and the caller didn't confirm deleting those too;
--   * they have a record on the desk (reviews, notes, awards, decisions): the
--     foreign keys refuse it, and the app says to revoke access instead.
--
-- Returns the storage objects to remove and the login to delete; the app does
-- both once this has committed.

create or replace function delete_person(p_person_id uuid, p_with_shots boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me people;
  v_target people;
  v_shots integer;
  v_posted integer;
  v_in_others integer;
  v_files jsonb;
begin
  select * into v_me from people where id = app_current_person_id();
  if v_me.id is null or v_me.role <> 'admin' or v_me.deactivated_at is not null then
    raise exception 'only an administrator can delete people' using errcode = 'insufficient_privilege';
  end if;

  select * into v_target from people
   where id = p_person_id and org_id = v_me.org_id
   for update;
  if not found then
    raise exception 'That person is not on your roster.' using errcode = 'no_data_found';
  end if;
  if v_target.id = v_me.id then
    raise exception 'You can''t delete yourself.' using errcode = 'check_violation';
  end if;

  select count(*), count(*) filter (where state = 'published')
    into v_shots, v_posted
    from captures where person_id = p_person_id;
  if v_posted > 0 then
    raise exception '% of their shots % posted. Take % down first.',
      v_posted, case when v_posted = 1 then 'is' else 'are' end, case when v_posted = 1 then 'it' else 'them' end
      using errcode = 'check_violation';
  end if;

  select count(*) into v_in_others
    from capture_people cp join captures c on c.id = cp.capture_id
   where cp.person_id = p_person_id
     and c.person_id <> p_person_id
     and c.state in ('approved', 'published');
  if v_in_others > 0 then
    raise exception 'They''re in % approved or posted shot% by other students. Withdraw their release first.',
      v_in_others, case when v_in_others = 1 then '' else 's' end
      using errcode = 'check_violation';
  end if;

  if v_shots > 0 and not p_with_shots then
    raise exception 'They have sent % shot%.', v_shots, case when v_shots = 1 then '' else 's' end
      using errcode = 'check_violation', hint = 'needs_with_shots';
  end if;

  select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', f.bucket, 'key', f.key)), '[]'::jsonb)
    into v_files
    from (
      select sm.bucket, sm.storage_key as key
        from submission_media sm join captures c on c.id = sm.submission_id
       where c.person_id = p_person_id
      union
      select c.bucket, c.storage_key from captures c
       where c.person_id = p_person_id and c.storage_key is not null
      union
      select c.bucket, c.proxy_key from captures c
       where c.person_id = p_person_id and c.proxy_key is not null
    ) f;

  -- Their own withdrawal requests would otherwise block deleting them.
  delete from capture_withdrawal_requests where requested_by = p_person_id;
  delete from captures where person_id = p_person_id;
  delete from people where id = p_person_id;

  insert into audit_log(org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_me.org_id, v_me.id, 'person.deleted', 'person', p_person_id,
          jsonb_build_object('role', v_target.role, 'shots_deleted', v_shots));

  return jsonb_build_object(
    'auth_user_id', v_target.auth_user_id,
    'files', v_files,
    'shots_deleted', v_shots
  );
end;
$$;

revoke execute on function delete_person(uuid, boolean) from public, anon;
grant execute on function delete_person(uuid, boolean) to authenticated;
