#!/usr/bin/env bash
# Phase 1: structural inventory only.
#
# Reads no substantive document text. Opens each PDF read-only just far
# enough to read a page count and an encryption flag. Safe to re-run: work
# already completed is skipped.
#
# Usage: scripts/run_phase1.sh [extra wri flags, e.g. --force]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

banner "Pre-flight checks"
run_wri doctor || {
    echo "Fix the problems above before running Phase 1." >&2
    exit 1
}

banner "Phase 1 - structural inventory"
run_wri phase1 "$@"

banner "Phase 1 finished. Review Phase_1_Summary.md before approving Phase 2."
