-- Once withdrawal is requested, staff can decide the request from metadata but
-- cannot keep viewing or downloading the student's media.
drop policy if exists captures_staff_read on storage.objects;
create policy captures_staff_read on storage.objects for select to authenticated
  using (
    bucket_id = 'captures'
    and (select app_is_staff())
    and exists (
      select 1 from captures c
       where c.id::text = (storage.foldername(name))[2]
         and c.org_id = (select app_current_org_id())
         and c.state not in ('withdrawal_requested', 'withdrawn')));
