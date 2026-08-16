---
name: av-qc
description: Automated QC gates + report for rendered deliverables. Run python3 scripts/qc.py --append docs/QC_REPORT.md; must be executed by a fresh-context qc agent, not the implementer.
---
# av-qc
Gates (all hard): stream conformity per SPECS in qc.py, duration ±1 frame, loudness -14 ±0.5 / TP ≤ -1.0, no unintended black (blackdetect, first 0.4s fade whitelisted) or freezes (end card whitelisted), caption spot-grabs at 3 timestamps, sidecars + safe-area proofs present.
Human checklist (appended every run, never self-acknowledged): transcript ⚠️ lines, media releases in all aspects, music license for paid + cutdowns, end-card copy sign-off, reframe sign-off.
The post-render hook (.claude/settings.json → scripts/qc_hook.sh) auto-appends results after any render.sh / remotion render Bash call.
