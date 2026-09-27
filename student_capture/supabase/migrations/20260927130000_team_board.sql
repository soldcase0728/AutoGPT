-- The team board: a student can choose to show their first name, with this
-- week's numbers, to the other members of their teams and groups. Off until
-- the student turns it on; the student can turn it off again at any time.
--
-- The choice lives in its own table with RLS on and no policies, so nobody,
-- staff included, can read or set it except through the two functions below,
-- and only the student can opt themselves in.

create table if not exists board_opt_ins (
  person_id    uuid primary key references people (id) on delete cascade,
  opted_in_at  timestamptz not null default now()
);

alter table board_opt_ins enable row level security;

create or replace function set_board_opt_in(p_show boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := app_current_person_id();
begin
  if v_me is null or not exists (select 1 from people where id = v_me and role = 'student') then
    raise exception 'only a student can choose to appear on the team board'
      using errcode = 'insufficient_privilege';
  end if;

  if p_show then
    insert into board_opt_ins (person_id) values (v_me) on conflict (person_id) do nothing;
  else
    delete from board_opt_ins where person_id = v_me;
  end if;

  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  select org_id, id, case when p_show then 'person.board_opt_in' else 'person.board_opt_out' end,
         'person', id, '{}'::jsonb
    from people where id = v_me;
  return p_show;
end;
$$;

-- For each group the caller belongs to: the teammates who opted in, by first
-- name only, with what they sent and what went live in the last 7 days.
create or replace function my_team_board()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select app_current_person_id() as person_id, app_current_org_id() as org_id
  ),
  my_groups as (
    select g.id, g.name, g.kind
      from me
      join student_group_members m on m.person_id = me.person_id
      join student_groups g on g.id = m.group_id and g.org_id = me.org_id
  ),
  entries as (
    select gm.group_id, p.id as person_id,
           split_part(btrim(p.display_name), ' ', 1) as first_name,
           (select count(*) from captures c
             where c.person_id = p.id and c.submitted_at >= now() - interval '7 days') as week_sent,
           (select count(*) from captures c
             where c.person_id = p.id and c.state = 'published'
               and c.state_changed_at >= now() - interval '7 days') as week_posted
      from my_groups g
      join student_group_members gm on gm.group_id = g.id
      join board_opt_ins o on o.person_id = gm.person_id
      join people p on p.id = gm.person_id
     where p.deactivated_at is null and p.participation = 'active' and p.role = 'student'
  )
  select case when (select person_id from me) is null then null else jsonb_build_object(
    'opted_in', exists (select 1 from board_opt_ins o, me where o.person_id = me.person_id),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name,
               'kind', g.kind,
               'entries', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'first_name', e.first_name,
                          'week_sent', e.week_sent,
                          'week_posted', e.week_posted,
                          'me', e.person_id = (select person_id from me))
                        order by e.week_sent desc, e.first_name)
                   from entries e where e.group_id = g.id), '[]'::jsonb))
             order by g.name)
        from my_groups g), '[]'::jsonb)
  ) end;
$$;

revoke all on table board_opt_ins from anon, authenticated;
revoke execute on function set_board_opt_in(boolean) from public, anon;
revoke execute on function my_team_board() from public, anon;
grant execute on function set_board_opt_in(boolean) to authenticated;
grant execute on function my_team_board() to authenticated;
