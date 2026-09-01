-- A submission belongs to a prompt directly. Assigned captures keep their
-- assignment link; Open Moment captures can omit it without inventing a fake
-- assignment row.

alter table captures
  add column prompt_id uuid references ideas (id) on delete restrict;

update captures c
   set prompt_id = a.idea_id
  from assignments a
 where a.id = c.assignment_id;

create or replace function enforce_capture_prompt_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assignment assignments;
  v_mode prompt_capture_mode;
  v_prompt_org uuid;
begin
  if new.assignment_id is not null then
    select * into v_assignment from assignments where id = new.assignment_id;
    if not found then raise exception 'assignment does not exist'; end if;
    if new.prompt_id is null then new.prompt_id := v_assignment.idea_id; end if;
    if new.prompt_id <> v_assignment.idea_id or new.person_id <> v_assignment.person_id then
      raise exception 'submission does not match its assignment';
    end if;
  elsif new.prompt_id is null then
    raise exception 'submission requires a prompt';
  end if;

  select i.capture_mode, cam.org_id into v_mode, v_prompt_org
    from ideas i join campaigns cam on cam.id = i.campaign_id
   where i.id = new.prompt_id;
  if not found or v_prompt_org <> new.org_id then
    raise exception 'submission prompt does not belong to its organization';
  end if;
  if new.assignment_id is null and v_mode <> 'OPEN_MOMENT' then
    raise exception 'assigned prompt requires an assignment';
  end if;
  return new;
end;
$$;

create trigger captures_prompt_link
  before insert or update of assignment_id, prompt_id, person_id, org_id on captures
  for each row execute function enforce_capture_prompt_link();

alter table captures
  alter column prompt_id set not null,
  alter column assignment_id drop not null;

create index captures_prompt_idx on captures (prompt_id, created_at desc);

-- Keep the existing review view's shape and consumers; only its prompt join
-- changes so assigned and Open Moment submissions appear in the same queue.
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
  join ideas i        on i.id   = c.prompt_id
  join campaigns cam  on cam.id = i.campaign_id
  left join capture_context ctx on ctx.capture_id = c.id;

revoke execute on function enforce_capture_prompt_link() from public, anon, authenticated;
