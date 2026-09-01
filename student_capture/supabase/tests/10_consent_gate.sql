\pset tuples_only on
\pset format unaligned

-- The consent gate, exercised across every branch it has.

create or replace function t_assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERT FAILED: %', msg; end if;
end $$;

create or replace function t_has_blocker(p_capture uuid, p_reason text) returns boolean
language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(capture_consent_blockers(p_capture)) b
    where b ->> 'reason' = p_reason)
$$;

\set org   '11111111-1111-1111-1111-111111111111'
\set idea  '51111111-1111-1111-1111-111111111111'
\set ali   '63333333-3333-3333-3333-333333333333'
\set jo    '64444444-4444-4444-4444-444444444444'
\set sam   '65555555-5555-5555-5555-555555555555'

insert into assignments (id, idea_id, person_id, due_on) values
  ('a0000000-0000-0000-0000-000000000001', :'idea', :'ali', current_date),
  ('a0000000-0000-0000-0000-000000000002', :'idea', :'ali', current_date - 1),
  ('a0000000-0000-0000-0000-000000000003', :'idea', :'ali', current_date - 2),
  ('a0000000-0000-0000-0000-000000000004', :'idea', :'jo',  current_date),
  ('a0000000-0000-0000-0000-000000000005', :'idea', :'sam', current_date);

insert into captures (id, assignment_id, person_id, org_id, bucket, storage_key,
                      state, no_people_in_frame) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   :'ali', :'org', 'captures', 'ali/c1/clip.mp4', 'approved', false),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   :'ali', :'org', 'captures', 'ali/c2/clip.mp4', 'approved', false),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
   :'ali', :'org', 'captures', 'ali/c3/clip.mp4', 'approved', true),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004',
   :'jo',  :'org', 'captures', 'jo/c4/clip.mp4',  'approved', false),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005',
   :'sam', :'org', 'captures', 'sam/c5/clip.mp4', 'approved', false);

insert into capture_people (capture_id, person_id) values
  ('c0000000-0000-0000-0000-000000000001', :'ali'),
  ('c0000000-0000-0000-0000-000000000004', :'jo'),
  ('c0000000-0000-0000-0000-000000000005', :'sam');

-- 1. An adult with a live release is clear.
select t_assert(capture_consent_ok('c0000000-0000-0000-0000-000000000001'),
                'adult with a live media release should pass');

-- 2. Nobody tagged and nothing affirmed is a blocker, not a silent pass.
select t_assert(t_has_blocker('c0000000-0000-0000-0000-000000000002', 'no_people_declared'),
                'untagged capture without an affirmation should be blocked');

-- 3. Affirming that nobody is identifiable clears it.
select t_assert(capture_consent_ok('c0000000-0000-0000-0000-000000000003'),
                'affirmed scenery shot should pass');

-- 4. A minor needs a parental release on top of their own.
select t_assert(t_has_blocker('c0000000-0000-0000-0000-000000000004', 'parental_missing'),
                'minor without parental consent should be blocked');

-- 5. Unknown age is treated as needing one, never waved through.
select t_assert(t_has_blocker('c0000000-0000-0000-0000-000000000005', 'age_unknown'),
                'unknown birth year should be blocked');

-- 6. The gate is a database invariant: publishing a blocked capture must fail
--    however the update arrives.
do $$
begin
  begin
    update captures set state = 'published'
     where id = 'c0000000-0000-0000-0000-000000000004';
    raise exception 'ASSERT FAILED: publishing a blocked capture should have raised';
  exception
    when check_violation then null;  -- expected
  end;
end $$;

select t_assert((select state from captures
                  where id = 'c0000000-0000-0000-0000-000000000004') = 'approved',
                'blocked capture must not have changed state');

-- 7. A clear capture publishes.
update captures set state = 'published'
 where id = 'c0000000-0000-0000-0000-000000000001';

-- 8. Withdrawing a release reaches back through anything already published.
update consents set revoked_at = now(), revoked_reason = 'withdrew after graduation'
 where person_id = '63333333-3333-3333-3333-333333333333' and type = 'media_release';

select t_assert((select state from captures
                  where id = 'c0000000-0000-0000-0000-000000000001') = 'approved',
                'revoking a release should pull the published capture back');

select t_assert(exists (select 1 from audit_log
                         where action = 'consent.revoked'
                           and subject_id = '63333333-3333-3333-3333-333333333333'),
                'revocation should leave an audit trail');

select t_assert(t_has_blocker('c0000000-0000-0000-0000-000000000001', 'media_release_revoked'),
                'revoked release should surface as a blocker');

-- 9. A live-but-expired release outranks a revoked one in the reason we report,
--    so the reviewer is told the most actionable thing.
insert into consents (person_id, type, document_version, signed_by, expires_at)
values ('63333333-3333-3333-3333-333333333333', 'media_release',
        'release-2025-01', 'Ali Haddad', now() - interval '1 day');

select t_assert(t_has_blocker('c0000000-0000-0000-0000-000000000001', 'media_release_expired'),
                'expired release should be reported ahead of a revoked one');

-- 10. A fresh signature clears it again.
insert into consents (person_id, type, document_version, signed_by)
values ('63333333-3333-3333-3333-333333333333', 'media_release',
        'release-2026-01', 'Ali Haddad');

select t_assert(capture_consent_ok('c0000000-0000-0000-0000-000000000001'),
                're-signing should clear the capture');

-- 11. The review feed carries the blockers with each row.
select t_assert((select count(*) from review_queue where org_id = :'org') = 5,
                'review_queue should expose every capture in the org');

select t_assert((select jsonb_array_length(consent_blockers) from review_queue
                  where id = 'c0000000-0000-0000-0000-000000000005') > 0,
                'review_queue should carry consent blockers inline');
