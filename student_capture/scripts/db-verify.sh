#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres cluster and runs the SQL
# tests. Needs the postgres binaries on PATH; no Docker, no network.
#
#   ./scripts/db-verify.sh
#
# Postgres refuses to run as root, so as root this re-execs itself as the
# `postgres` system user.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
export PATH="$PGBIN:$PATH"

if [ "$(id -u)" = "0" ]; then
  RUNAS="${PG_RUNAS:-postgres}"
  WORK="$(mktemp -d)"; chown "$RUNAS" "$WORK"
  exec su "$RUNAS" -s /bin/bash -c "PGBIN='$PGBIN' PGWORK='$WORK' '$0' \"\$@\"" -- "$@"
fi

WORK="${PGWORK:-$(mktemp -d)}"
DATA="$WORK/data"
SOCK="$WORK/sock"
mkdir -p "$DATA" "$SOCK"

cleanup() { pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

cd "$REPO"

echo "==> initdb"
initdb -D "$DATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATA" -o "-k $SOCK -h '' -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null
export PGHOST="$SOCK" PGUSER=postgres PGDATABASE=postgres

run() {
  if out=$(psql -v ON_ERROR_STOP=1 -q -f "$1" 2>&1); then
    echo "    ok  $1"
  else
    echo "    FAIL $1"; echo "$out" | sed "s/^/        /"; exit 1
  fi
}

echo "==> shims"
run supabase/tests/00_shims.sql
echo "==> migrations"
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/tests/99_grants.sql
echo "==> seed"
run supabase/seed.sql
echo "==> tests"
for f in supabase/tests/[1-8]*_*.sql; do run "$f"; done

echo
echo "database verified"
