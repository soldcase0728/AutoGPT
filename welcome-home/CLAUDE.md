# welcome-home — OLSM "Welcome Home" v4 production repo

Every session inherits this file. Read it before touching anything.

## Brand constants (single source of truth: `remotion/src/brand.ts`)
- **Colors:** OLSM red `#B32C1C` (sampled from cap-toss footage, analysis/palette.json shot8) · deep navy `#101823` · ivory `#F4EFE6` · sepia amber `#B37C4D` (archival shots only)
- **Type:** Playfair Display Black (display) · Playfair Medium (taglines) · Montserrat SemiBold (captions). Files: `source/brand/*.ttf`
- **Banned phrases:** "world-class", "state-of-the-art", "like family", "excellence in education" (as slogan). No CTAs on the current cut (kickoff decision: pure brand).
- **Formation thesis (voice):** Nothing here happens by chance — character, faith, and excellence are *formed*, deliberately, in community, since 1885. Declarative, unhurried, no exclamation points, no superlatives.
- **Safe areas @1080×1920:** 220 top / 320 bottom / 60 sides.

## File layout
```
source/           raw clips, audio stems (vo_lkmatch.wav = canonical VO), brand fonts, v3 reference master
analysis/         probe.json edl.csv transcript.json audio.json beats.json palette.json
remotion/         timeline-as-code; src/edl.ts mirrors analysis/edl.csv; src/brand.ts = tokens
captions/         master.srt / master.vtt (script-corrected)
reframe/          crops.json (1x1 keyframes — DRAFT until human sign-off)
luts/             olsm_warm.cube (47dB PSNR vs original filter chain)
scripts/          grade.sh · audio_post.sh · render.sh · qc.py · qc_hook.sh
deliverables/     rendered matrix (gitignored)
docs/             PLAN.md BRIEF.md QC_REPORT.md CHANGELOG.md proofs/
.claude/          skills/ agents/ settings.json (post-render QC hook)
```

## Render commands
- Full matrix: `bash scripts/render.sh` (QC auto-runs via PostToolUse hook)
- Audio only: `bash scripts/audio_post.sh`
- One still: `cd remotion && npx remotion still Master9x16 --frame=N out.png`
- QC alone: `python3 scripts/qc.py --append docs/QC_REPORT.md` (run via the **qc agent, fresh context**)

## QC thresholds (hard gates)
- Loudness: **-14 ±0.5 LUFS integrated, true peak ≤ -1.0 dBTP** (two-pass loudnorm only)
- Duration ±1 frame vs spec; yuv420p + faststart on all mp4s; no unintended black/freeze
- Human checklist in QC_REPORT.md is never self-acknowledged by an agent

## Key facts
- Master: 33.0s @30fps 1080×1920 = 30.4s picture + end card entering at **29.72s** (beat-snapped: last beat 27.86 + one bar @129.2bpm)
- Canonical VO: `vo_lkmatch.wav` — LK-paced Adam voice, sentences seated to shots (analysis/transcript.json)
- The Alex narration variant omits the "Parents" sentence — do not use it for the master without re-approval
- Music: "For Positive Classic V4" (licensed pack, no attribution required; keep license receipt)
- Media is **gitignored**; sources live in the owner's Google Drive (folder: "0-Master OLS photos" mirror + uploaded AI clips). Chat delivery history has all finished cuts.

## Skills
`video-forensics` · `olsm-brand-kit` · `remotion-motion-system` · `audio-post` · `deliverables-matrix` · `av-qc` — see `.claude/skills/*/SKILL.md`. Subagents: editor, audio-post, motion, qc (`.claude/agents/`).
