#!/usr/bin/env bash
# Full pipeline: Phase 1, then Phase 2 over the whole production, then
# Phase 3 derived metadata and review workbooks, then the QC sample.
#
# Run this ONLY after the Phase 1 summary and the Phase 2 pilot results
# have both been reviewed and approved. Each stage is resumable, so an
# interrupted run can be restarted with the same command.
#
# Usage: scripts/run_full.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

banner "Pre-flight checks"
run_wri doctor || { echo "Fix the problems above first." >&2; exit 1; }

banner "Stage 1 of 4 - structural inventory"
run_wri phase1

banner "Stage 2 of 4 - text and page-condition audit (full production)"
run_wri phase2 --full

banner "Stage 3 of 4 - derived metadata and review workbooks"
run_wri phase3

banner "Stage 4 of 4 - quality-control sample"
run_wri qc

banner "Full run complete. Read Final_Run_Summary.md, then inspect QC_Sample.xlsx."
