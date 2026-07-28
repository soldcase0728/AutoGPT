-- ---------------------------------------------------------------------------
-- Participant waivers.
--
-- Until now only the requester signed anything. The stated goal is a signed
-- release for EVERY person using a facility, so a booking can now mint a public
-- waiver link and collect one signed document per participant.
--
-- NOTE: `prisma migrate diff` also proposes
--     ALTER TABLE booking_occupancy ALTER COLUMN time_range DROP NOT NULL;
-- That is deliberately NOT applied. The column is declared
-- `Unsupported("tstzrange")?` in schema.prisma because the trigger populates it
-- and Prisma must not require it on insert; the database keeps it NOT NULL so
-- the exclusion constraint can never see a null range. Ignore that line on
-- future diffs.
-- ---------------------------------------------------------------------------

ALTER TABLE "bookings" ADD COLUMN "waiver_token" TEXT;

CREATE UNIQUE INDEX "bookings_waiver_token_key" ON "bookings"("waiver_token");

ALTER TABLE "documents"
  ADD COLUMN "is_participant" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_minor"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guardian_name"  TEXT,
  ADD COLUMN "guardian_email" TEXT;

-- A minor's waiver is not valid without a named guardian.
ALTER TABLE "documents"
  ADD CONSTRAINT documents_minor_requires_guardian
  CHECK (NOT is_minor OR guardian_name IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Security deposit resolution.
--
-- A deposit is a manual-capture authorisation, so it ends one of two ways:
-- released untouched, or partially captured for damage. Both need to be
-- recorded as first-class state -- an unresolved hold expires at Stripe after
-- about a week, so "nobody got round to it" has a real financial consequence.
-- ---------------------------------------------------------------------------

ALTER TABLE "invoices"
  ADD COLUMN "deposit_captured_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deposit_resolved_at"    TIMESTAMPTZ(3),
  ADD COLUMN "deposit_capture_reason" TEXT;

ALTER TABLE "invoices"
  ADD CONSTRAINT invoices_deposit_capture_within_hold
  CHECK (deposit_captured_cents >= 0 AND deposit_captured_cents <= deposit_cents);

-- Participant lookups are always scoped to a booking.
CREATE INDEX "documents_booking_participant_idx"
  ON "documents" ("booking_id", "is_participant");
