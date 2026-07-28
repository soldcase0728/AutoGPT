#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Container start-up.
#
# Applies migrations before the server accepts traffic, then optionally loads
# reference data. Everything here is idempotent, so a restart or a second
# replica is safe.
# ---------------------------------------------------------------------------

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set." >&2
  exit 1
fi

if [ -z "$SESSION_SECRET" ] || [ "${#SESSION_SECRET}" -lt 32 ]; then
  echo "FATAL: SESSION_SECRET must be set and at least 32 characters." >&2
  echo "       Generate one with: openssl rand -base64 32" >&2
  exit 1
fi

echo "==> Applying database migrations"
./node_modules/.bin/prisma migrate deploy

# Reference data: the eight facilities, the rules matrix, rate cards, sports.
# Seeding is upsert-based, so running it on every boot is harmless and keeps a
# redeploy from drifting away from the committed reference data.
if [ "${SEED_ON_BOOT:-1}" = "1" ]; then
  echo "==> Seeding reference data"
  node dist-scripts/seed.js
else
  echo "==> Skipping seed (SEED_ON_BOOT=0)"
fi

# A week of sample bookings, for an instance whose only job is to be clicked
# through. Requires an explicit confirmation because it writes fake bookings.
if [ "${LOAD_DEMO_DATA:-0}" = "1" ]; then
  echo "==> Loading demo bookings"
  DEMO_DATA_CONFIRM=yes node dist-scripts/demo-data.js
fi

echo "==> Starting server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec "$@"
