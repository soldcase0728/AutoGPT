#!/usr/bin/env bash
# Applies the migrations (and optionally the demo seed) to a real database.
#
#   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/db-apply.sh [--seed]
#
# Use the Supabase project's direct connection string, not the pooler: the
# migrations create types, triggers and policies.
set -euo pipefail

cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL to the target database}"

for f in supabase/migrations/*.sql; do
  echo "==> $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

if [ "${1:-}" = "--seed" ]; then
  echo "==> supabase/seed.sql"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
fi

echo "done"
