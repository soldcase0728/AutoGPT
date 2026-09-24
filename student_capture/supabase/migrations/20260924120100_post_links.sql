-- Post links: when the marketing desk marks a capture posted, it can record where
-- the post lives, so the student can see their work go live.

alter table captures
  add column if not exists post_url text
    check (post_url is null or (post_url ~* '^https://\S+$' and length(post_url) <= 2048));

-- Students can update their own capture while it uploads, so the column needs its
-- own guard: only staff (or the database itself, with no signed-in person) may
-- write a post link.
create or replace function guard_capture_post_url()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app_current_person_id() is null or app_is_staff() then return new; end if;
  if (tg_op = 'INSERT' and new.post_url is not null)
     or (tg_op = 'UPDATE' and new.post_url is distinct from old.post_url) then
    raise exception 'only the marketing desk may set a post link'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists captures_post_url_guard on captures;
create trigger captures_post_url_guard
  before insert or update of post_url on captures
  for each row execute function guard_capture_post_url();

create or replace function set_capture_post_url(p_capture_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_url text := nullif(trim(p_url), '');
  v_capture captures;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may set a post link'
      using errcode = 'insufficient_privilege';
  end if;
  if v_url is not null and (v_url !~* '^https://\S+$' or length(v_url) > 2048) then
    raise exception 'the post link must be a full https:// address'
      using errcode = 'check_violation';
  end if;

  select * into v_capture from captures where id = p_capture_id for update;
  if not found or v_capture.org_id <> app_current_org_id() then
    raise exception 'capture does not exist';
  end if;
  if v_capture.state <> 'published' then
    raise exception 'only a posted capture can have a post link'
      using errcode = 'check_violation';
  end if;

  update captures set post_url = v_url where id = p_capture_id;
  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_capture.org_id, v_actor, 'capture.post_url', 'capture', p_capture_id,
          jsonb_build_object('post_url', v_url));
end;
$$;

revoke execute on function set_capture_post_url(uuid, text) from public, anon;
grant execute on function set_capture_post_url(uuid, text) to authenticated;
