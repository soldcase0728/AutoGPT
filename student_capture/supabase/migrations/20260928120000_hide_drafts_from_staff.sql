-- A shot the student hasn't sent is theirs alone. Staff could read every
-- capture in their school, drafts included, and through them the draft's
-- files, tags and caption. Nothing in the app showed drafts to staff, but the
-- data was reachable. Staff now see a capture only once it has been sent.
--
-- The files, tag and caption policies all check the capture through this
-- table, so hiding the capture hides them too.

drop policy if exists captures_read on captures;
create policy captures_read on captures for select
  using (person_id = app_current_person_id()
         or (app_is_staff() and org_id = app_current_org_id() and state <> 'uploading'));
