#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL to the Supabase direct connection string}"
: "${SAFETY_WORKER_URL:?set SAFETY_WORKER_URL to https://your-app/api/internal/safety/process}"
: "${SAFETY_WORKER_SECRET:?set SAFETY_WORKER_SECRET to the matching Vercel secret}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v worker_url="$SAFETY_WORKER_URL" \
  -v worker_secret="$SAFETY_WORKER_SECRET" \
  -f supabase/operations/configure_safety_scheduler.sql

echo "safety worker and watchdog scheduled"
