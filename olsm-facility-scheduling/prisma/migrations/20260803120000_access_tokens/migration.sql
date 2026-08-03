-- One-time links for setting a password.
--
-- Two problems are being fixed here at once.
--
-- The first is that there was no way to create an account. Everybody in the
-- database came from the seed; sign-in through Entra deliberately refuses to
-- provision an unknown address, and no administrator screen could add one. This
-- table is what an invitation is made of.
--
-- The second is how the old links were stored. A verification token used to be
-- written into "sessions" as the primary key, in clear text, which meant any
-- read of that table -- a backup, a support query, a log -- handed over a
-- working link for every account that had not used theirs yet. Only the
-- SHA-256 is kept here, so the table is worth nothing to whoever reads it.

CREATE TABLE "access_tokens" (
  "id"           TEXT NOT NULL,
  "token_hash"   TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "expires_at"   TIMESTAMPTZ(3) NOT NULL,
  "consumed_at"  TIMESTAMPTZ(3),
  "issued_by_id" TEXT,
  "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_tokens_token_hash_key" ON "access_tokens"("token_hash");
CREATE INDEX "access_tokens_user_id_consumed_at_idx" ON "access_tokens"("user_id", "consumed_at");

ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Any verification link already sitting in "sessions" is a live credential of
-- exactly the kind this migration exists to stop storing, and /verify is gone,
-- so the links no longer resolve. Retire them rather than leave them readable.
-- A real session row is a uuid; the old tokens were 24 random bytes rendered
-- base64url, which is 32 characters and never matches the uuid shape.
DELETE FROM "sessions"
WHERE "id" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
