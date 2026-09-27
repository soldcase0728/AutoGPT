-- Shot of the Day: an administrator picks one accepted shot per school day,
-- with an optional note on what made it great. The student who shot it sees
-- the award on their pages; staff see it in the queue and on the overview.
--
-- One award per school per date. Picking again for the same date replaces the
-- pick. Only shots the school accepted (approved or posted) can win, and an
-- award stops showing if its shot is later withdrawn or taken down.

create table if not exists shot_awards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  capture_id  uuid not null references captures (id) on delete cascade,
  awarded_on  date not null,
  note        text check (note is null or char_length(note) <= 280),
  awarded_by  uuid not null references people (id),
  created_at  timestamptz not null default now(),
  unique (org_id, awarded_on)
);

create index if not exists shot_awards_capture_idx on shot_awards (capture_id);

alter table shot_awards enable row level security;

-- Staff see their school's awards; a student sees awards for their own shots.
drop policy if exists shot_awards_read on shot_awards;
create policy shot_awards_read on shot_awards for select
  using (
    (app_is_staff() and org_id = app_current_org_id())
    or exists (select 1 from captures c
                where c.id = capture_id and c.person_id = app_current_person_id())
  );

-- No write policies: awards change only through the functions below.
revoke insert, update, delete on shot_awards from anon, authenticated;
grant select on shot_awards to authenticated;

create or replace function award_shot_of_the_day(p_capture_id uuid, p_date date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org   uuid;
  v_state capture_state;
  v_id    uuid;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app_is_admin() then
    raise exception 'only an administrator can award Shot of the Day'
      using errcode = 'insufficient_privilege';
  end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 7 then
    raise exception 'Shot of the Day can be awarded for today or the past week'
      using errcode = 'check_violation';
  end if;

  select org_id, state into v_org, v_state from captures where id = p_capture_id;
  if v_org is null or v_org <> app_current_org_id() then
    raise exception 'that shot is not in your school' using errcode = 'insufficient_privilege';
  end if;
  if v_state not in ('approved', 'published') then
    raise exception 'only an approved or posted shot can be Shot of the Day'
      using errcode = 'check_violation';
  end if;

  insert into shot_awards (org_id, capture_id, awarded_on, note, awarded_by)
  values (v_org, p_capture_id, p_date, v_note, app_current_person_id())
  on conflict (org_id, awarded_on) do update
     set capture_id = excluded.capture_id, note = excluded.note,
         awarded_by = excluded.awarded_by, created_at = now()
  returning id into v_id;

  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, app_current_person_id(), 'capture.shot_of_the_day', 'capture', p_capture_id,
          jsonb_build_object('awarded_on', p_date));
  return v_id;
end;
$$;

create or replace function remove_shot_of_the_day(p_award_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row shot_awards;
begin
  if not app_is_admin() then
    raise exception 'only an administrator can change Shot of the Day'
      using errcode = 'insufficient_privilege';
  end if;
  delete from shot_awards where id = p_award_id and org_id = app_current_org_id()
  returning * into v_row;
  if v_row.id is not null then
    insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
    values (v_row.org_id, app_current_person_id(), 'capture.shot_of_the_day_removed', 'capture',
            v_row.capture_id, jsonb_build_object('awarded_on', v_row.awarded_on));
  end if;
end;
$$;

revoke execute on function award_shot_of_the_day(uuid, date, text) from public, anon;
revoke execute on function remove_shot_of_the_day(uuid) from public, anon;
grant execute on function award_shot_of_the_day(uuid, date, text) to authenticated;
grant execute on function remove_shot_of_the_day(uuid) to authenticated;
