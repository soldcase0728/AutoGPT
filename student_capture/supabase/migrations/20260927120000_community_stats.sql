-- What a student sees of everyone else's effort: school-wide and team totals
-- for the last 7 days, as counts only. Students cannot read each other's
-- captures, so this runs as definer and returns numbers, never names or rows.
--
-- A group's total is only returned to its own members, and only once it has
-- at least 5 members, so no student can work out one classmate's activity by
-- subtraction.

create or replace function my_community_stats()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select app_current_person_id() as person_id, app_current_org_id() as org_id
  ),
  week as (
    select c.person_id, c.state, c.submitted_at, c.state_changed_at
      from captures c, me
     where c.org_id = me.org_id
       and (c.submitted_at >= now() - interval '7 days'
            or (c.state = 'published' and c.state_changed_at >= now() - interval '7 days'))
  ),
  my_groups as (
    select g.id, g.name, g.kind, count(m2.person_id)::int as members
      from me
      join student_group_members m on m.person_id = me.person_id
      join student_groups g on g.id = m.group_id and g.org_id = me.org_id
      join student_group_members m2 on m2.group_id = g.id
     group by g.id, g.name, g.kind
    having count(m2.person_id) >= 5
  )
  select case when (select person_id from me) is null then null else jsonb_build_object(
    'week_posted',
      (select count(*) from week where state = 'published' and state_changed_at >= now() - interval '7 days'),
    'week_contributors',
      (select count(distinct person_id) from week where submitted_at >= now() - interval '7 days'),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name,
               'kind', g.kind,
               'members', g.members,
               'week_sent', (select count(*) from week w
                               join student_group_members gm on gm.person_id = w.person_id and gm.group_id = g.id
                              where w.submitted_at >= now() - interval '7 days'))
             order by g.name)
        from my_groups g), '[]'::jsonb)
  ) end;
$$;

revoke execute on function my_community_stats() from public, anon;
grant execute on function my_community_stats() to authenticated;
