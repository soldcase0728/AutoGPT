-- Certificate-of-insurance review.
--
-- Uploading a certificate used to satisfy the gate outright, so a booking
-- could confirm on a file nobody had opened. Accepting one is an attestation
-- that its limits are adequate, which is a judgement a person makes; these
-- states and columns are what let a person make it and leave a record.

ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "documents" ADD COLUMN "reviewed_by_id" TEXT;
ALTER TABLE "documents" ADD COLUMN "reviewed_at" TIMESTAMPTZ(3);
ALTER TABLE "documents" ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "documents" ADD COLUMN "internal_note" TEXT;
ALTER TABLE "documents" ADD COLUMN "supersedes_id" TEXT;

CREATE UNIQUE INDEX "documents_supersedes_id_key" ON "documents"("supersedes_id");

ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
