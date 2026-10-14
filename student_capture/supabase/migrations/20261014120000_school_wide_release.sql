-- The school holds a school-wide media release covering every student in
-- photos and video, so students no longer say who is in a shot.
--
-- Before: a shot with nobody tagged was blocked from posting unless the
-- student affirmed nobody was identifiable. Now an untagged shot is clear.
-- Shots that do carry tags (from before this change) are still checked
-- against each tagged person's own and parental releases.
--
-- Consequence: withdrawing one person's release only pulls back posts they
-- were tagged in. Shots sent after this change have no tags, so the desk has
-- to find those by hand.

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

  -- Nobody tagged: covered by the school-wide release.
  if not exists (select 1 from capture_people where capture_id = p_capture_id) then
    return '[]'::jsonb;
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
