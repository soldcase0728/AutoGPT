\pset tuples_only on
\pset format unaligned

-- Lifecycle, withdrawal, idempotency, and revocation-during-upload behavior.

insert into assignments (id, idea_id, person_id, due_on) values
  ('b5000000-0000-0000-0000-000000000001',
   '51111111-1111-1111-1111-111111111111',
   '63333333-3333-3333-3333-333333333333', current_date + 50);

insert into captures (
  id, assignment_id, person_id, org_id, bucket, storage_key,
  state, client_submission_id
) values
  ('c5000000-0000-0000-0000-000000000001',
   'b5000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'captures', '63333333-3333-3333-3333-333333333333/c500/direct.mp4',
   'uploading', '15000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-0000-0000-000000000002',
   'b5000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'captures', '63333333-3333-3333-3333-333333333333/c500/review.mp4',
   'submitted', '15000000-0000-4000-8000-000000000002'),
  ('c5000000-0000-0000-0000-000000000003',
   'b5000000-0000-0000-0000-000000000001',
   '63333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'captures', '63333333-3333-3333-3333-333333333333/c500/revoked.mp4',
   'uploading', '15000000-0000-4000-8000-000000000003');

do $$
begin
  begin
    insert into captures (
      id, assignment_id, person_id, org_id, bucket, storage_key, client_submission_id
    ) values (
      'c5000000-0000-0000-0000-000000000004',
      'b5000000-0000-0000-0000-000000000001',
      '63333333-3333-3333-3333-333333333333',
      '11111111-1111-1111-1111-111111111111',
      'captures', '63333333-3333-3333-3333-333333333333/c500/duplicate.mp4',
      '15000000-0000-4000-8000-000000000001');
    raise exception 'ASSERT FAILED: duplicate client submission ID was accepted';
  exception when unique_violation then null;
  end;
end $$;

update submission_media
   set client_media_id = '25000000-0000-4000-8000-000000000001'
 where submission_id = 'c5000000-0000-0000-0000-000000000001' and sort_order = 0;

do $$
begin
  begin
    insert into submission_media (
      submission_id, media_type, bucket, storage_key, sort_order, client_media_id
    ) values (
      'c5000000-0000-0000-0000-000000000001', 'video', 'captures',
      '63333333-3333-3333-3333-333333333333/c500/duplicate-media.mp4', 1,
      '25000000-0000-4000-8000-000000000001');
    raise exception 'ASSERT FAILED: duplicate client media ID was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- Uploading and unreviewed work can be withdrawn immediately by its owner.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  select withdraw_capture('c5000000-0000-0000-0000-000000000001', 'Wrong person in frame');
commit;

select t_assert(
  (select state = 'withdrawn' and withdrawn_at is not null
          and retention_due_at between now() + interval '29 days'
                                   and now() + interval '31 days'
     from captures where id = 'c5000000-0000-0000-0000-000000000001'),
  'direct withdrawal should be terminal and schedule media retention');
select t_assert(
  exists (select 1 from audit_log where action = 'capture.withdrawn'
           and subject_id = 'c5000000-0000-0000-0000-000000000001'),
  'direct withdrawal should be audited');

-- Opening is atomic and changes the withdrawal path to staff-assisted.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select open_capture_for_review('c5000000-0000-0000-0000-000000000002');
commit;

select t_assert(
  (select state = 'in_review' and review_started_at is not null
          and review_started_by = '62222222-2222-2222-2222-222222222222'
     from captures where id = 'c5000000-0000-0000-0000-000000000002'),
  'review open should atomically record who opened the submission');

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  select withdraw_capture('c5000000-0000-0000-0000-000000000002', 'Schedule visible');
commit;

select t_assert(
  (select state = 'withdrawal_requested'
     from captures where id = 'c5000000-0000-0000-0000-000000000002')
  and exists (select 1 from capture_withdrawal_requests
               where capture_id = 'c5000000-0000-0000-0000-000000000002'
                 and decision is null and previous_state = 'in_review'),
  'withdrawal after review starts should become a staff request');

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select decide_capture_withdrawal(
    (select id from capture_withdrawal_requests
      where capture_id = 'c5000000-0000-0000-0000-000000000002' and decision is null),
    'denied', 'Already exported; coordinate deletion');
commit;

select t_assert(
  (select state = 'in_review' from captures
    where id = 'c5000000-0000-0000-0000-000000000002')
  and exists (select 1 from capture_withdrawal_requests
               where capture_id = 'c5000000-0000-0000-0000-000000000002'
                 and decision = 'denied'),
  'denied withdrawal should restore the exact previous state');

-- Revocation closes both envelope and media mutation paths for an upload that
-- was reserved while the student was active.
update people set participation = 'revoked'
 where id = '63333333-3333-3333-3333-333333333333';
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000a1', true);
  update captures set width = 999
   where id = 'c5000000-0000-0000-0000-000000000003';
  update submission_media set width = 999
   where submission_id = 'c5000000-0000-0000-0000-000000000003';
commit;

select t_assert(
  (select width is null from captures
    where id = 'c5000000-0000-0000-0000-000000000003')
  and (select width is null from submission_media
       where submission_id = 'c5000000-0000-0000-0000-000000000003'
         and sort_order = 0),
  'revocation during upload should prevent all remaining submission mutations');
update people set participation = 'active'
 where id = '63333333-3333-3333-3333-333333333333';

select t_assert(
  not has_function_privilege('anon', 'withdraw_capture(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'open_capture_for_review(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'withdraw_capture(uuid,text)', 'EXECUTE'),
  'lifecycle RPC grants should expose only the authenticated surface');
