-- Coach-requested standing blocks.
--
-- A standing block now carries an approval status. Blocks an administrator
-- lays down are APPROVED from birth -- the default below also stamps every
-- existing row, all of which were admin-entered -- while a block a coach
-- requests starts PENDING and only joins the season allocation once the
-- athletic office approves it. DENIED rows are kept as the record of what was
-- asked and why it was refused.
--
-- start_date / end_date bound a block *within* its season, for the team whose
-- competition calendar is shorter than the season that hosts it ("November to
-- February" inside a November-to-March winter). Null means the season's dates.
--
-- Note: `prisma migrate dev` also wanted to drop documents_booking_participant_idx
-- and the NOT NULL on booking_occupancy.time_range here. Both live in
-- hand-written SQL migrations that Prisma cannot see the intent of
-- (participant_waivers and overlap_and_audit_constraints); dropping them would
-- be a regression, so those statements were removed from this file by hand.
ALTER TABLE "standing_blocks"
  ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "request_note" TEXT,
  ADD COLUMN "decided_by_id" TEXT,
  ADD COLUMN "decided_at" TIMESTAMPTZ(3),
  ADD COLUMN "decision_note" TEXT,
  ADD COLUMN "start_date" DATE,
  ADD COLUMN "end_date" DATE;

CREATE INDEX "standing_blocks_status_idx" ON "standing_blocks"("status");

ALTER TABLE "standing_blocks"
  ADD CONSTRAINT "standing_blocks_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
