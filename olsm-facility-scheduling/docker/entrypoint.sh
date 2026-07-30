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
  echo "FATAL: SESSION_SECRET is not set (or is shorter than 32 characters)." >&2
  echo "" >&2
  echo "  Compose reads .env from the directory holding the compose file." >&2
  echo "  Create it, then start again:" >&2
  echo "" >&2
  echo "    cat > .env <<EOF" >&2
  echo "    SESSION_SECRET=\$(openssl rand -base64 32)" >&2
  echo "    POSTGRES_PASSWORD=\$(openssl rand -base64 24)" >&2
  echo "    EOF" >&2
  echo "" >&2
  echo "  If the database has already started once without that file, see the" >&2
  echo "  note about POSTGRES_PASSWORD in DEPLOY.md -- changing it after the" >&2
  echo "  volume is initialised requires recreating the volume." >&2
  exit 1
fi

# The cron service shares this image and so runs this entrypoint before every
# invocation. Migrating and seeding on a five-minute timer is pointless work
# against the database and races the web service on deploy, so the cron sets
# RUN_MIGRATIONS=0. The web service leaves it at the default and still migrates
# before it accepts traffic.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "==> Applying database migrations"
  if ! ./node_modules/.bin/prisma migrate deploy; then
    echo "" >&2
    echo "FATAL: could not apply migrations." >&2
    echo "" >&2
    echo "  If the error above mentions authentication, the most likely cause is" >&2
    echo "  a POSTGRES_PASSWORD that changed after the database volume was first" >&2
    echo "  created. Postgres bakes the password in on first initialisation and" >&2
    echo "  ignores the environment variable from then on, so a new value in" >&2
    echo "  .env no longer matches what the volume expects." >&2
    echo "" >&2
    echo "  While the data is still disposable, the fix is to recreate it:" >&2
    echo "" >&2
    echo "    docker compose -f docker-compose.prod.yml down -v" >&2
    echo "    docker compose -f docker-compose.prod.yml up -d" >&2
    echo "" >&2
    echo "  DELETES THE DATABASE. Fine for a pilot with demo data; make a dump" >&2
    echo "  first once real bookings exist." >&2
    exit 1
  fi
else
  echo "==> Skipping migrations (RUN_MIGRATIONS=$RUN_MIGRATIONS)"
fi

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
