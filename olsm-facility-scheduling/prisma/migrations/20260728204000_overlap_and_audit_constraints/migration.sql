-- ---------------------------------------------------------------------------
-- Database-level guarantees.
--
-- Everything in this file exists because application-level validation is not
-- good enough for the two things that carry real consequences: double-booking
-- a space, and tampering with the liability paper trail.
-- ---------------------------------------------------------------------------

-- btree_gist lets a GiST exclusion constraint mix an equality column (text)
-- with an overlap column (tstzrange).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Overlap prevention
--
-- booking_occupancy holds one row per sub-space a booking physically occupies,
-- already expanded through the conflict graph and already padded with
-- setup/teardown buffer. Rows exist only while a booking is holding the slot
-- (PENDING_APPROVAL .. CHECKED_IN); the booking service deletes them when a
-- booking is cancelled, denied, expired or completed.
--
-- The range is half-open '[)' so a 15:30-17:30 booking and a 17:30-19:30
-- booking in the same space do not collide.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION booking_occupancy_set_range() RETURNS trigger AS $$
BEGIN
  IF NEW.end_at <= NEW.start_at THEN
    RAISE EXCEPTION 'booking_occupancy end_at (%) must be after start_at (%)',
      NEW.end_at, NEW.start_at
      USING ERRCODE = '22000';
  END IF;
  NEW.time_range := tstzrange(NEW.start_at, NEW.end_at, '[)');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_occupancy_set_range_trg
  BEFORE INSERT OR UPDATE OF start_at, end_at ON booking_occupancy
  FOR EACH ROW EXECUTE FUNCTION booking_occupancy_set_range();

ALTER TABLE booking_occupancy
  ALTER COLUMN time_range SET NOT NULL;

-- The constraint the whole system leans on. Acceptance criteria 4 and 5.
ALTER TABLE booking_occupancy
  ADD CONSTRAINT booking_occupancy_no_overlap
  EXCLUDE USING gist (
    sub_space_id WITH =,
    time_range   WITH &&
  );

COMMENT ON CONSTRAINT booking_occupancy_no_overlap ON booking_occupancy IS
  'Two bookings may not hold the same sub-space at overlapping times. Sub-space '
  'containment (Full floor vs Court A) is handled by expanding each booking into '
  'every sub-space it occupies before insert.';

-- ---------------------------------------------------------------------------
-- 2. Append-only audit log
--
-- No role may UPDATE, DELETE or TRUNCATE audit_log. A superuser can still drop
-- these triggers, so production should run the application as a non-superuser
-- role -- see the deployment section of README.md.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- ---------------------------------------------------------------------------
-- 3. Sanity constraints
-- ---------------------------------------------------------------------------

ALTER TABLE bookings
  ADD CONSTRAINT bookings_end_after_start CHECK (end_at > start_at);

ALTER TABLE blackouts
  ADD CONSTRAINT blackouts_end_after_start CHECK (end_at > start_at);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_refund_within_total CHECK (refunded_cents >= 0 AND refunded_cents <= total_cents);

-- A sub-space may not list itself in its own conflict set; that would make
-- every booking self-conflicting.
ALTER TABLE sub_spaces
  ADD CONSTRAINT sub_spaces_no_self_block CHECK (NOT (id = ANY(blocks_ids)));

-- Postgres treats NULLs as distinct in a unique index, so the
-- (activity_type, requester_role) unique constraint does not stop two generic
-- fallback rules for the same activity type. This partial index does.
CREATE UNIQUE INDEX rules_generic_fallback_uniq
  ON rules (activity_type)
  WHERE requester_role IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Booking references
--
-- Human-quotable and gap-tolerant. A sequence rather than count(*)+1 so two
-- simultaneous requests cannot mint the same reference.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START 1;
