-- Row level security.
--
-- Every helper below is SECURITY DEFINER so that policies on `people` can look
-- up the caller's own row without recursing through the policy that is being
-- evaluated. They are STABLE, so Postgres evaluates them once per statement.

create or replace function app_current_person_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.id from people p
  where p.auth_user_id = auth.uid() and p.deactivated_at is null
$$;

create or replace function app_current_org_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.org_id from people p
  where p.auth_user_id = auth.uid() and p.deactivated_at is null
$$;

create or replace function app_current_person_role()
returns person_role language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from people p
  where p.auth_user_id = auth.uid() and p.deactivated_at is null
$$;

create or replace function app_is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app_current_person_role() in ('reviewer', 'admin'), false)
$$;

create or replace function app_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app_current_person_role() = 'admin', false)
$$;

alter table organizations     enable row level security;
alter table people            enable row level security;
alter table guideline_sets    enable row level security;
alter table guideline_versions enable row level security;
alter table acknowledgements  enable row level security;
alter table consents          enable row level security;
alter table campaigns         enable row level security;
alter table ideas             enable row level security;
alter table assignments       enable row level security;
alter table captures          enable row level security;
alter table capture_people    enable row level security;
alter table capture_context   enable row level security;
alter table reviews           enable row level security;
alter table audit_log         enable row level security;

-- ------------------------------------------------------------------ read paths

create policy org_read on organizations for select
  using (id = app_current_org_id());

create policy people_read on people for select
  using (id = app_current_person_id()
         or (app_is_staff() and org_id = app_current_org_id()));

create policy people_admin_write on people for all
  using (app_is_admin() and org_id = app_current_org_id())
  with check (app_is_admin() and org_id = app_current_org_id());

create policy guideline_sets_read on guideline_sets for select
  using (org_id = app_current_org_id());

create policy guideline_sets_admin_write on guideline_sets for all
  using (app_is_admin() and org_id = app_current_org_id())
  with check (app_is_admin() and org_id = app_current_org_id());

create policy guideline_versions_read on guideline_versions for select
  using (exists (select 1 from guideline_sets gs
                 where gs.id = set_id and gs.org_id = app_current_org_id()));

create policy guideline_versions_admin_write on guideline_versions for all
  using (app_is_admin() and exists (select 1 from guideline_sets gs
                 where gs.id = set_id and gs.org_id = app_current_org_id()))
  with check (app_is_admin() and exists (select 1 from guideline_sets gs
                 where gs.id = set_id and gs.org_id = app_current_org_id()));

create policy acks_own on acknowledgements for select
  using (person_id = app_current_person_id() or app_is_staff());

create policy acks_insert_own on acknowledgements for insert
  with check (person_id = app_current_person_id());

create policy campaigns_read on campaigns for select
  using (org_id = app_current_org_id());

create policy campaigns_admin_write on campaigns for all
  using (app_is_admin() and org_id = app_current_org_id())
  with check (app_is_admin() and org_id = app_current_org_id());

create policy ideas_read on ideas for select
  using (exists (select 1 from campaigns c
                 where c.id = campaign_id and c.org_id = app_current_org_id()));

create policy ideas_admin_write on ideas for all
  using (app_is_admin() and exists (select 1 from campaigns c
                 where c.id = campaign_id and c.org_id = app_current_org_id()))
  with check (app_is_admin() and exists (select 1 from campaigns c
                 where c.id = campaign_id and c.org_id = app_current_org_id()));

-- --------------------------------------------------------------------- consent

-- Reviewers need to read consents to see why a capture is blocked from publish.
create policy consents_read on consents for select
  using (person_id = app_current_person_id()
         or (app_is_staff() and exists (select 1 from people p
                where p.id = person_id and p.org_id = app_current_org_id())));

-- A person may sign their own media release. Parental and NIL releases are
-- recorded by an admin against evidence, never self-asserted by the student.
create policy consents_self_sign on consents for insert
  with check (person_id = app_current_person_id() and type = 'media_release');

create policy consents_admin_write on consents for all
  using (app_is_admin() and exists (select 1 from people p
                where p.id = person_id and p.org_id = app_current_org_id()))
  with check (app_is_admin() and exists (select 1 from people p
                where p.id = person_id and p.org_id = app_current_org_id()));

-- ----------------------------------------------------------------- assignments

create policy assignments_read on assignments for select
  using (person_id = app_current_person_id()
         or (app_is_staff() and exists (select 1 from people p
                where p.id = person_id and p.org_id = app_current_org_id())));

-- Assignments are materialised by the scheduled job, which runs as the service
-- role and bypasses RLS. No client-side write path exists on purpose.

-- -------------------------------------------------------------------- captures

create policy captures_read on captures for select
  using (person_id = app_current_person_id()
         or (app_is_staff() and org_id = app_current_org_id()));

create policy captures_insert_own on captures for insert
  with check (person_id = app_current_person_id()
              and org_id = app_current_org_id());

-- A student may edit their capture only while it is still uploading. Once
-- submitted it belongs to the review queue.
create policy captures_update_own_while_uploading on captures for update
  using (person_id = app_current_person_id() and state = 'uploading')
  with check (person_id = app_current_person_id());

create policy captures_staff_update on captures for update
  using (app_is_staff() and org_id = app_current_org_id())
  with check (app_is_staff() and org_id = app_current_org_id());

create policy capture_people_read on capture_people for select
  using (exists (select 1 from captures c where c.id = capture_id
                 and (c.person_id = app_current_person_id()
                      or (app_is_staff() and c.org_id = app_current_org_id()))));

create policy capture_people_write_own on capture_people for all
  using (exists (select 1 from captures c where c.id = capture_id
                 and c.person_id = app_current_person_id() and c.state = 'uploading'))
  with check (exists (select 1 from captures c where c.id = capture_id
                 and c.person_id = app_current_person_id() and c.state = 'uploading'));

create policy capture_context_read on capture_context for select
  using (exists (select 1 from captures c where c.id = capture_id
                 and (c.person_id = app_current_person_id()
                      or (app_is_staff() and c.org_id = app_current_org_id()))));

create policy capture_context_write_own on capture_context for all
  using (exists (select 1 from captures c where c.id = capture_id
                 and c.person_id = app_current_person_id() and c.state = 'uploading'))
  with check (exists (select 1 from captures c where c.id = capture_id
                 and c.person_id = app_current_person_id() and c.state = 'uploading'));

-- --------------------------------------------------------------------- reviews

create policy reviews_read on reviews for select
  using (exists (select 1 from captures c where c.id = capture_id
                 and (c.person_id = app_current_person_id()
                      or (app_is_staff() and c.org_id = app_current_org_id()))));

create policy reviews_staff_insert on reviews for insert
  with check (app_is_staff()
              and reviewer_id = app_current_person_id()
              and exists (select 1 from captures c
                          where c.id = capture_id and c.org_id = app_current_org_id()));

create policy audit_read on audit_log for select
  using (app_is_admin() and org_id = app_current_org_id());
