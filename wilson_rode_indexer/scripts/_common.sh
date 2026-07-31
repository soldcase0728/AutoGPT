#!/usr/bin/env bash
# Shared setup for the phase runner scripts.
#
# The source production folder is never written to by any of these
# scripts. All output goes to the derived-index folder named in config.yaml.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Prefer a project-local virtualenv when one exists.
if [[ -x ".venv/bin/python" ]]; then
    PY=".venv/bin/python"
elif command -v python3.12 >/dev/null 2>&1; then
    PY="python3.12"
elif command -v python3 >/dev/null 2>&1; then
    PY="python3"
else
    echo "ERROR: no Python 3 interpreter found." >&2
    exit 1
fi

run_wri() {
    "$PY" -m src.cli "$@"
}

banner() {
    printf '\n========================================================================\n'
    printf '%s\n' "$1"
    printf '========================================================================\n'
}
