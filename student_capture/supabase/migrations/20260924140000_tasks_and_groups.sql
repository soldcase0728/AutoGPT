-- Task lifecycle and student groups for the admin portal.

-- A cancelled task stays for the record (its submissions keep pointing at it)
-- but is never shown or assigned again. Paused is `active = false` without this.
alter table ideas add column if not exists cancelled_at timestamptz;

-- Groups: teams, grades, programs, or any saved list of students, used to pick
-- who gets a task. Deliberately nothing academic beyond a label.
create table if not exists student_groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 80),
  kind       text not null default 'list' check (kind in ('team', 'grade', 'program', 'list')),
  created_by uuid references people (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists student_groups_org_name_key
  on student_groups (org_id, lower(name));

create table if not exists student_group_members (
  group_id  uuid not null references student_groups (id) on delete cascade,
  person_id uuid not null references people (id) on delete cascade,
  primary key (group_id, person_id)
);

create index if not exists student_group_members_person_idx
  on student_group_members (person_id);

alter table student_groups enable row level security;
alter table student_group_members enable row level security;

drop policy if exists student_groups_staff_read on student_groups;
create policy student_groups_staff_read on student_groups for select
  using (app_is_staff() and org_id = app_current_org_id());

drop policy if exists student_groups_admin_write on student_groups;
create policy student_groups_admin_write on student_groups for all
  using (app_is_admin() and org_id = app_current_org_id())
  with check (app_is_admin() and org_id = app_current_org_id());

drop policy if exists student_group_members_staff_read on student_group_members;
create policy student_group_members_staff_read on student_group_members for select
  using (exists (select 1 from student_groups g
                 where g.id = group_id and app_is_staff() and g.org_id = app_current_org_id()));

-- Members must belong to the group's organisation.
drop policy if exists student_group_members_admin_write on student_group_members;
create policy student_group_members_admin_write on student_group_members for all
  using (exists (select 1 from student_groups g
                 where g.id = group_id and app_is_admin() and g.org_id = app_current_org_id()))
  with check (exists (select 1 from student_groups g join people p on p.id = person_id
                      where g.id = group_id and app_is_admin()
                        and g.org_id = app_current_org_id() and p.org_id = g.org_id));

revoke all on student_groups, student_group_members from anon;
grant select, insert, update, delete on student_groups, student_group_members to authenticated;
