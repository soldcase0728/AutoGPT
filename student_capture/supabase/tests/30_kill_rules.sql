\pset tuples_only on
\pset format unaligned

-- Product kill rules, asserted as database behaviour. Each test names the rule
-- it defends, so a change that breaks one fails loudly rather than quietly.
-- Fixtures are local to this file: a shared capture whose state another test
-- already moved would make these assertions lie.

\set org  '11111111-1111-1111-1111-111111111111'
\set idea '51111111-1111-1111-1111-111111111111'

insert into people (id, org_id, role, display_name, email, birth_year, participation) values
  ('71111111-1111-1111-1111-111111111111', :'org', 'student',
   'Kit Active',  'kit@example.edu',  1999, 'active'),
  ('72222222-2222-2222-2222-222222222222', :'org', 'student',
   'Pat Pending', 'pat@example.edu',  1999, 'pending'),
  ('73333333-3333-3333-3333-333333333333', :'org', 'student',
   'Robin Gone',  'robin@example.edu', 1999, 'revoked');

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'kit@example.edu'),
  ('e0000000-0000-0000-0000-000000000002', 'pat@example.edu'),
  ('e0000000-0000-0000-0000-000000000003', 'robin@example.edu');

insert into assignments (id, idea_id, person_id, due_on) values
  ('b0000000-0000-0000-0000-000000000001', :'idea',
   '71111111-1111-1111-1111-111111111111', current_date);

insert into captures (id, assignment_id, person_id, org_id, bucket, storage_key, state)
values ('f0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        '71111111-1111-1111-1111-111111111111', :'org',
        'captures', 'kit/f1/clip.mp4', 'uploading');

-- ============================================================ rule 1
-- A student submission is never an approval.

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);

  -- The one move a student is allowed to make.
  update captures set state = 'submitted'
   where id = 'f0000000-0000-0000-0000-000000000001';

  select t_assert(
    (select state from captures where id = 'f0000000-0000-0000-0000-000000000001') = 'submitted',
    'rule 1: a student must be able to submit');
rollback;

do $$
declare v_state capture_state;
begin
  foreach v_state in array array['approved', 'published', 'rejected']::capture_state[]
  loop
    declare v_after capture_state;
    begin
      begin
        set local role authenticated;
        perform set_config('request.jwt.claim.sub',
                           'e0000000-0000-0000-0000-000000000001', true);
        execute format(
          'update captures set state = %L where id = %L',
          v_state, 'f0000000-0000-0000-0000-000000000001');
      exception when others then
        null;  -- refusal is the desired outcome
      end;
      reset role;

      select state into v_after from captures
       where id = 'f0000000-0000-0000-0000-000000000001';
      if v_after = v_state then
        raise exception 'ASSERT FAILED (rule 1): a student set state to %', v_state;
      end if;
    end;
  end loop;
end $$;

-- ============================================================ rule 7
-- Credential status cannot be bypassed. A roster row is not an approval.

do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',
                       'e0000000-0000-0000-0000-000000000002', true);  -- pending
    insert into captures (assignment_id, person_id, org_id, bucket, storage_key)
    values ('b0000000-0000-0000-0000-000000000001',
            '72222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'captures', 'pat/x/clip.mp4');
    reset role;
    raise exception 'ASSERT FAILED (rule 7): a pending person filed a capture';
  exception when insufficient_privilege then
    reset role;  -- expected
  end;
end $$;

do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',
                       'e0000000-0000-0000-0000-000000000003', true);  -- revoked
    insert into captures (assignment_id, person_id, org_id, bucket, storage_key)
    values ('b0000000-0000-0000-0000-000000000001',
            '73333333-3333-3333-3333-333333333333',
            '11111111-1111-1111-1111-111111111111', 'captures', 'robin/x/clip.mp4');
    reset role;
    raise exception 'ASSERT FAILED (rule 7): a revoked person filed a capture';
  exception when insufficient_privilege then
    reset role;  -- expected: revoked is read-only
  end;
end $$;

select t_assert(
  (select participation from people where email = 'kit@example.edu') = 'active'
  and (select count(*) from people where participation = 'pending') > 0,
  'rule 7: participation is tracked per person');

-- ============================================================ rules 2 and 3
-- Terms are accepted once per version, and new wording needs a new acceptance.

select t_assert(
  has_current_release('63333333-3333-3333-3333-333333333333', 'release-2026-01'),
  'rule 2: someone who accepted the current wording is not asked again');

select t_assert(
  not has_current_release('63333333-3333-3333-3333-333333333333', 'release-2027-01'),
  'rule 3: new wording is not covered by an older acceptance');

-- The old signature survives the new one rather than being replaced.
insert into consents (person_id, type, document_version, signed_by)
values ('63333333-3333-3333-3333-333333333333', 'media_release',
        'release-2027-01', 'Ali Haddad');

select t_assert(
  (select count(*) from consents
    where person_id = '63333333-3333-3333-3333-333333333333'
      and type = 'media_release'
      and document_version = 'release-2026-01') > 0,
  'rule 3: accepting new wording must not erase the earlier acceptance');

do $$
begin
  begin
    update consents set document_version = 'release-2027-01'
     where person_id = '63333333-3333-3333-3333-333333333333'
       and document_version = 'release-2026-01';
    raise exception 'ASSERT FAILED (rule 3): a consent record was edited in place';
  exception when check_violation then
    null;  -- expected
  end;
end $$;

-- ============================================================ rule 5
-- Protected material found after posting comes down, with the reason kept.

do $$
begin
  begin
    perform take_down_capture('f0000000-0000-0000-0000-000000000001', 'ID card visible');
    raise exception 'ASSERT FAILED (rule 5): a takedown ran without staff rights';
  exception when insufficient_privilege then
    null;  -- expected: no signed-in staff in this context
  end;
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);

  do $$
  begin
    begin
      perform take_down_capture('f0000000-0000-0000-0000-000000000001', '   ');
      raise exception 'ASSERT FAILED (rule 5): a takedown ran without a reason';
    exception when check_violation then
      null;  -- expected
    end;
  end $$;

  select take_down_capture('f0000000-0000-0000-0000-000000000001',
                           'Student ID card readable at 0:04');
rollback;

-- Re-run outside the rolled-back block so the effect persists for assertions.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000d4', true);
  select take_down_capture('f0000000-0000-0000-0000-000000000001',
                           'Student ID card readable at 0:04');
commit;

select t_assert(
  (select state from captures where id = 'f0000000-0000-0000-0000-000000000001') = 'rejected'
  and (select takedown_reason from captures
        where id = 'f0000000-0000-0000-0000-000000000001') is not null
  and (select takedown_at from captures
        where id = 'f0000000-0000-0000-0000-000000000001') is not null,
  'rule 5: a takedown pulls the capture and records why');

select t_assert(
  exists (select 1 from audit_log where action = 'capture.taken_down'
           and subject_id = 'f0000000-0000-0000-0000-000000000001'),
  'rule 5: a takedown leaves an audit trail');

-- ============================================================ rule 6
-- Anyone can report unsafe filming — including the student who was asked.

begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);

  insert into safety_flags (org_id, capture_id, reported_by, kind, detail)
  values ('11111111-1111-1111-1111-111111111111',
          'f0000000-0000-0000-0000-000000000001',
          '71111111-1111-1111-1111-111111111111',
          'unsafe_filming',
          'The prompt asked me to film while walking down a stairwell.');
commit;

select t_assert(
  (select count(*) from safety_flags where kind = 'unsafe_filming') = 1,
  'rule 6: a student can report unsafe filming');

select t_assert(
  exists (select 1 from audit_log where action = 'safety.flagged'),
  'rule 6: a safety report raises an alert in the audit trail');

select t_assert(
  (select count(*) from safety_flags where acknowledged_at is null) = 1,
  'rule 6: an unacknowledged report stays open');
