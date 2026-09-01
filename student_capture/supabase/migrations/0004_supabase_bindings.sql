-- Bindings to Supabase-managed schemas: auth.users and storage.
-- Split out from the core migrations so the rest can be applied to any Postgres.

-- Roster-gated access. Students are added to `people` up front; signing in only
-- claims an existing row. Someone who authenticates without one has no profile
-- and the app tells them they are not on a roster.
create or replace function link_person_to_auth_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update people
     set auth_user_id = new.id
   where auth_user_id is null
     and deactivated_at is null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_person_to_auth_user();

-- ------------------------------------------------------------------- storage

-- Private bucket. Masters are only ever reached through short-lived signed URLs
-- minted server-side; nothing here is world-readable.
insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

-- Keys are `<person_id>/<capture_id>/<filename>`, so the first path segment is
-- the authorisation check.
drop policy if exists captures_student_insert on storage.objects;
create policy captures_student_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'captures'
              and (storage.foldername(name))[1] = app_current_person_id()::text);

drop policy if exists captures_owner_read on storage.objects;
create policy captures_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'captures'
         and (storage.foldername(name))[1] = app_current_person_id()::text);

drop policy if exists captures_staff_read on storage.objects;
create policy captures_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'captures' and app_is_staff());
