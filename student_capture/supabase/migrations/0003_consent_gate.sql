-- The consent gate.
--
-- This is a database invariant, not an application convention: the trigger at
-- the bottom refuses to move a capture into `published` while any person in
-- frame is unaccounted for, no matter which client asks.

-- Which consent of this type currently governs this person?
-- Prefers a live consent over a revoked or expired one, then the most recent.
create or replace function consent_state(p_person_id uuid, p_type consent_type)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case
              when c.revoked_at is not null then 'revoked'
              when c.expires_at is not null and c.expires_at <= now() then 'expired'
              else 'valid'
            end
       from consents c
      where c.person_id = p_person_id
        and c.type = p_type
      order by (c.revoked_at is null) desc,
               (c.expires_at is null or c.expires_at > now()) desc,
               c.signed_at desc
      limit 1),
    'missing');
$$;

-- Returns [] when the capture is clear to publish, otherwise one object per
-- reason, shaped for direct display in the review UI.
create or replace function capture_consent_blockers(p_capture_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_capture  captures;
  v_blockers jsonb := '[]'::jsonb;
  v_person   record;
  v_state    text;
begin
  select * into v_capture from captures where id = p_capture_id;
  if not found then
    return jsonb_build_array(jsonb_build_object('reason', 'capture_not_found'));
  end if;

  if not exists (select 1 from capture_people where capture_id = p_capture_id) then
    -- Nobody tagged. That is only acceptable if the student affirmed it.
    if v_capture.no_people_in_frame then
      return '[]'::jsonb;
    end if;
    return jsonb_build_array(jsonb_build_object(
      'reason', 'no_people_declared',
      'detail', 'Tag everyone in frame, or affirm that nobody is identifiable.'));
  end if;

  for v_person in
    select p.id, p.display_name, p.birth_year
      from capture_people cp
      join people p on p.id = cp.person_id
     where cp.capture_id = p_capture_id
     order by p.display_name
  loop
    v_state := consent_state(v_person.id, 'media_release');
    if v_state <> 'valid' then
      v_blockers := v_blockers || jsonb_build_object(
        'person_id', v_person.id,
        'person',    v_person.display_name,
        'reason',    'media_release_' || v_state);
    end if;

    if v_person.birth_year is null then
      -- Unknown age is a blocker, not a pass. We cannot tell whether a
      -- parental release is required, so we assume it is.
      v_blockers := v_blockers || jsonb_build_object(
        'person_id', v_person.id,
        'person',    v_person.display_name,
        'reason',    'age_unknown');
    elsif (extract(year from now())::int - v_person.birth_year) < 18 then
      v_state := consent_state(v_person.id, 'parental');
      if v_state <> 'valid' then
        v_blockers := v_blockers || jsonb_build_object(
          'person_id', v_person.id,
          'person',    v_person.display_name,
          'reason',    'parental_' || v_state);
      end if;
    end if;
  end loop;

  return v_blockers;
end;
$$;

create or replace function capture_consent_ok(p_capture_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_array_length(capture_consent_blockers(p_capture_id)) = 0
$$;

-- ------------------------------------------------------------- publish barrier

create or replace function enforce_consent_before_publish()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state = 'published' and old.state is distinct from 'published' then
    if not capture_consent_ok(new.id) then
      raise exception
        'capture % cannot be published; consent blockers: %',
        new.id, capture_consent_blockers(new.id)
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger captures_publish_gate
  before update on captures
  for each row execute function enforce_consent_before_publish();

-- --------------------------------------------------- revocation reaches back

-- A release that is withdrawn has to reach anything already published. Pulling
-- captures back to `approved` takes them out of every published surface and
-- leaves them in the queue for a human to deal with.
create or replace function unpublish_on_consent_revoke()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org_id  uuid;
  v_pulled  uuid[];
begin
  if new.revoked_at is null or old.revoked_at is not null then
    return new;
  end if;

  select org_id into v_org_id from people where id = new.person_id;

  with pulled as (
    update captures c
       set state = 'approved'
     where c.state = 'published'
       and exists (select 1 from capture_people cp
                    where cp.capture_id = c.id and cp.person_id = new.person_id)
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_pulled from pulled;

  insert into audit_log (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org_id, null, 'consent.revoked', 'person', new.person_id,
          jsonb_build_object(
            'consent_id',   new.id,
            'consent_type', new.type,
            'reason',       new.revoked_reason,
            'unpublished',  to_jsonb(v_pulled)));

  return new;
end;
$$;

create trigger consents_revoke_unpublish
  after update on consents
  for each row execute function unpublish_on_consent_revoke();

-- ----------------------------------------------------------------- review feed

-- One row per capture with everything a reviewer needs to make a call, so the
-- queue is a single query. security_invoker keeps the caller's RLS in force.
create or replace view review_queue
with (security_invoker = true) as
select c.id,
       c.org_id,
       c.person_id,
       p.display_name              as student,
       c.state,
       c.kind,
       c.mime,
       c.duration_s,
       c.width,
       c.height,
       c.master_bytes,
       c.bucket,
       c.storage_key,
       c.proxy_key,
       c.scan_status,
       c.exif_stripped,
       c.no_people_in_frame,
       c.checklist_ticked,
       c.created_at,
       c.submitted_at,
       ctx.one_liner,
       ctx.location_label,
       i.id                        as idea_id,
       i.title                     as idea_title,
       i.brief                     as idea_brief,
       i.format_spec,
       cam.name                    as campaign_name,
       capture_consent_blockers(c.id) as consent_blockers
  from captures c
  join people p       on p.id   = c.person_id
  join assignments a  on a.id   = c.assignment_id
  join ideas i        on i.id   = a.idea_id
  join campaigns cam  on cam.id = i.campaign_id
  left join capture_context ctx on ctx.capture_id = c.id;
