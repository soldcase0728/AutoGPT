-- Links a roster row to a login that already exists with the same email.
-- The auth trigger only links at the moment a login is created, so a person
-- added to the roster after their login existed stayed unlinked, and the admin
-- UI had no way to fix it.

create or replace function link_person_login(p_person_id uuid)
returns uuid language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_user uuid;
begin
  if not app_is_admin() then
    raise exception 'only an administrator may link logins'
      using errcode = 'insufficient_privilege';
  end if;

  select u.id into v_user
    from people p
    join auth.users u on lower(u.email) = lower(p.email)
   where p.id = p_person_id
     and p.org_id = app_current_org_id()
     and p.auth_user_id is null
     and p.deactivated_at is null
     and not exists (select 1 from people q where q.auth_user_id = u.id)
   limit 1;

  if v_user is null then
    return null;
  end if;

  update people set auth_user_id = v_user where id = p_person_id;
  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  select org_id, app_current_person_id(), 'person.login_linked', 'person', id, '{}'::jsonb
    from people where id = p_person_id;
  return v_user;
end;
$$;

revoke execute on function link_person_login(uuid) from public, anon;
grant execute on function link_person_login(uuid) to authenticated;
