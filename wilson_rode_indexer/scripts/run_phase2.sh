#!/usr/bin/env bash
# Phase 2: text and page-condition audit.
#
# Runs the ~200-document pilot sample by default. Pass --full only after
# the pilot results have been reviewed and approved.
#
# Usage:
#   scripts/run_phase2.sh              # pilot sample
#   scripts/run_phase2.sh --full       # whole production
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

banner "Phase 2 - text and page-condition audit"
run_wri phase2 "$@"

banner "Phase 2 finished. Review the accuracy notes in the summary document."
