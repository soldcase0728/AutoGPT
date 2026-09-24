-- Two kinds of reviewer writing, kept apart:
--   reviews.note            the message the student reads ("Marketing desk: …")
--   review_internal_notes   staff-only context, never shown to the student
-- A separate table rather than a column, because students can read their own
-- `reviews` rows and row-level security cannot hide a single column.

create table if not exists review_internal_notes (
  id         uuid primary key default gen_random_uuid(),
  capture_id uuid not null references captures (id) on delete cascade,
  org_id     uuid not null references organizations (id) on delete cascade,
  author_id  uuid not null references people (id) on delete restrict,
  review_id  uuid references reviews (id) on delete set null,
  note       text not null check (length(trim(note)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists review_internal_notes_capture_idx
  on review_internal_notes (capture_id, created_at desc);

alter table review_internal_notes enable row level security;

drop policy if exists review_internal_notes_staff_read on review_internal_notes;
create policy review_internal_notes_staff_read on review_internal_notes for select
  using (app_is_staff() and org_id = app_current_org_id());

-- Written only through the functions below.
revoke all on review_internal_notes from anon;
revoke insert, update, delete on review_internal_notes from authenticated;
grant select on review_internal_notes to authenticated;

-- review_capture gains an internal note. Same checks and transitions as
-- 20260902141048_submission_lifecycle_contract.sql.
drop function if exists review_capture(uuid, capture_state, text);
create or replace function review_capture(
  p_capture_id uuid,
  p_decision capture_state,
  p_note text default null,
  p_internal_note text default null)
returns capture_state language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_capture captures;
  v_review_id uuid;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may review captures'
      using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected', 'published') then
    raise exception 'invalid review decision' using errcode = 'check_violation';
  end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then
    raise exception 'changes need a note' using errcode = 'check_violation';
  end if;

  select * into v_capture from captures where id = p_capture_id for update;
  if not found or v_capture.org_id <> app_current_org_id() then
    raise exception 'capture does not exist';
  end if;
  if v_capture.state = 'withdrawal_requested' then
    raise exception 'resolve the withdrawal request before reviewing'
      using errcode = 'check_violation';
  end if;
  if v_capture.state = 'submitted' then
    raise exception 'open the capture before deciding it' using errcode = 'check_violation';
  end if;
  if not (
    (v_capture.state = 'in_review'
     and p_decision in ('approved', 'changes_requested', 'rejected'))
    or (v_capture.state = 'changes_requested'
        and p_decision in ('approved', 'rejected'))
    or (v_capture.state = 'approved' and p_decision = 'published')
  ) then
    raise exception 'decision % is not available from state %', p_decision, v_capture.state
      using errcode = 'check_violation';
  end if;

  update captures set state = p_decision where id = p_capture_id;
  insert into reviews (capture_id, reviewer_id, state, note)
  values (p_capture_id, v_actor, p_decision, nullif(trim(p_note), ''))
  returning id into v_review_id;
  if coalesce(trim(p_internal_note), '') <> '' then
    insert into review_internal_notes (capture_id, org_id, author_id, review_id, note)
    values (p_capture_id, v_capture.org_id, v_actor, v_review_id, trim(p_internal_note));
  end if;
  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_capture.org_id, v_actor, 'capture.' || p_decision::text,
          'capture', p_capture_id, jsonb_build_object('note', nullif(trim(p_note), '')));
  return p_decision;
end;
$$;

revoke execute on function review_capture(uuid, capture_state, text, text) from public, anon;
grant execute on function review_capture(uuid, capture_state, text, text) to authenticated;

-- take_down_capture gains a message for the student. The reason stays the
-- permanent internal record; the message is what the student reads.
drop function if exists take_down_capture(uuid, text);
create or replace function take_down_capture(
  p_capture_id uuid,
  p_reason text,
  p_student_message text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app_current_person_id();
  v_org   uuid;
  v_review_id uuid;
begin
  if not app_is_staff() then
    raise exception 'only the marketing desk may take a capture down'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a takedown needs a reason' using errcode = 'check_violation';
  end if;

  select org_id into v_org from captures where id = p_capture_id;
  if v_org is null then
    raise exception 'capture % does not exist', p_capture_id;
  end if;

  update captures
     set state = 'rejected',
         takedown_at = now(),
         takedown_reason = p_reason,
         takedown_by = v_actor
   where id = p_capture_id;

  insert into reviews (capture_id, reviewer_id, state, note)
  values (p_capture_id, v_actor, 'rejected', nullif(trim(p_student_message), ''))
  returning id into v_review_id;
  insert into review_internal_notes (capture_id, org_id, author_id, review_id, note)
  values (p_capture_id, v_org, v_actor, v_review_id, 'Taken down: ' || trim(p_reason));

  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, v_actor, 'capture.taken_down', 'capture', p_capture_id,
          jsonb_build_object('reason', p_reason,
                             'student_message', nullif(trim(p_student_message), '')));
end;
$$;

revoke execute on function take_down_capture(uuid, text, text) from public, anon;
grant execute on function take_down_capture(uuid, text, text) to authenticated;
