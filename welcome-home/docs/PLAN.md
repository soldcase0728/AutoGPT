# PLAN — "Welcome Home" v4 Production Pipeline (docs/PLAN.md)

## Context

Nine finished videos were built this session with ad-hoc ffmpeg pipelines. The user has now issued a formal operating protocol: rebuild the flagship 30.4s "Welcome Home" film as a **reproducible, QC-gated production repo** with Remotion timeline-as-code, brand tokens, skills, subagents, a post-render QC hook, and a full deliverables matrix. Plan-mode forensics are done; this plan maps the protocol onto what actually exists in this workspace.

**Forensics findings (read-only, complete):**
- Canonical picture: `OLSM_WelcomeHome_v2_Cross/v3_LKtone` share one video stream — 1080×1920, 30fps, yuv420p, H.264/AAC, 30.4s, 9 shots at known offsets (2.57/5.69/8.65/11.75/18.95/22.70/26.55/28.25 + 0.7s dissolves) — no scene detection guesswork needed, the EDL is authored.
- Loudness of v3_LKtone: **I = -14.96 LUFS, TP = -1.04 dBTP, LRA 4.4** → needs two-pass loudnorm to land -14 ±0.5 / ≤ -1.0 exactly.
- **MODE A confirmed**: all raw sources present (10 AI clips in `build_clips/`, 25 panoramas in `tour/`, 2 drone masters, church.mov) **plus true stems** (`vo_lkmatch.wav` LK-tuned VO, `For Positive Classic V4.wav` licensed music, `lk_ref.m4a` reference).
- Whisper word timestamps for every narration already computed; sentence→shot seating map is authored data.
- Env: Node 22.22 ✓ (Remotion), Python 3.11 + faster-whisper 1.2.1 ✓; **to install**: scenedetect[opencv], librosa, Pillow (pypi allowed). Disk: 25 GB free ✓.

**Kickoff decisions (locked by user):**
1. End card: **pure brand, no CTA** — crest-less type: "Welcome home." + wordmark on deep navy.
2. Brand: **derive from session** — Playfair Display (display) / Montserrat (captions), OLSM red sampled from footage palette in Phase 1.
3. Canonical narration: **LK-tuned Adam** (full script incl. Parents line) = `vo_lkmatch.wav`.
4. Captions: **correct to script** ("forged in community", "you do not arrive as strangers") — the two ⚠️ lines resolved.

## Repo & Git Strategy

- New local repo at **`/home/user/welcome-home/`** with the protocol's layout. Media (source clips, WAVs, renders) **gitignored** — the 821 MB drone file and renders can't live on GitHub. Committed: code, docs, analysis JSONs, captions, skills, agents, CLAUDE.md.
- Phase-gate commits: `phase-0-env` … `phase-9-qc`.
- At completion, the code/docs tree (no media) is copied into the session's designated branch (`claude/ols-drone-motivational-video-ditdzn` on soldcase0728/AutoGPT) under `welcome-home/` and pushed, so the pipeline survives this ephemeral container. Media persistence stays with the user's Drive + chat deliveries.

## Phases

**Phase 0 — Environment.** `pip install "scenedetect[opencv]" librosa Pillow`; scaffold repo layout; copy sources into `source/` (raw/, audio/ stems, brand/); `git init` + commit. Remotion: `npm create video` pinned template into `remotion/` (npm registry allowed).

**Phase 1 — Forensic ingest.** Emit `analysis/probe.json` (ffprobe -of json on master + all raw clips); `analysis/edl.csv` from the authored offsets **validated** by `scenedetect detect-adaptive` on the master (flag drift > 2 frames); re-run faster-whisper on `vo_lkmatch.wav` → `analysis/transcript.json` + draft `captions/master.srt` with script-corrected text; `analysis/audio.json` (loudnorm JSON + astats for master and stems); `analysis/beats.json` via librosa on FPC V4; `analysis/palette.json` — 1 frame/shot, dominant hexes (seeds brand red/navy/ivory) + signalstats clip check. Commit `phase-1-forensics`. **Gate:** post shot list + transcript summary to chat (⚠️ lines pre-resolved).

**Phase 2 — Creative brief.** One-page `docs/BRIEF.md`: audiences (prospective parents first, 7th–8th graders second), formation thesis, the 8-beat arc (seal→quad→podium→cross→brothers→choir-breath→1885→double cap toss→end card), v4 upgrade targets over v3 (exact loudness, captions, end card, multi-aspect, reproducibility), deliverables matrix, type/color tokens. Commit `phase-2-brief`. **Gate:** posted to chat for approval alongside Phase 1 outputs.

**Phase 3 — Timeline as code (MODE A).** Remotion project: `remotion/src/brand.ts` (tokens), one `<Composition>` per deliverable (Master9x16 ≈ 33.5s = 30.4 + ~3.1s end card, Square1x1, Wide16x9, Cutdown15s). Timeline rebuilt from `edl.csv` with `<OffthreadVideo>` sequences of raw clips; per-shot conform matches the authored trims/speeds; sentence starts pinned to `transcript.json` word times; end-card entrance + cutdown edits snapped to `beats.json`. Commit `phase-3-timeline`.

**Phase 4 — Picture.** The validated session grade (colortemperature 4600 + eq + colorbalance) is exported as a **Hald-CLUT → `luts/olsm_warm.cube`** for portability and applied via `lut3d` in the render ladder; bloom/vignette/grain (not LUT-able) remain explicit filter steps identical to v3. Historic sepia clip keeps its distinct treatment (excluded from warm LUT). No stabilization (drone/AI clips show no jitter in EDL stills), no sharpening beyond the existing conform, no denoise. Commit `phase-4-picture`.

**Phase 5 — Type & motion.** Remotion components: `<Title>` (Playfair, 6–8 frame letter-tracked fade/rise — replaces baked plates for "Class of 2031" + wordmark), `<Caption>` (Montserrat, scrim), `<EndCard>` (deep navy, "Welcome home." line 1, "ORCHARD LAKE ST. MARY'S" line 2, no CTA). Safe areas 220 top / 320 bottom / 60 sides at 1080×1920; safe-area overlay proof still per deliverable → `docs/proofs/`. Commit `phase-5-motion`.

**Phase 6 — Audio post (stems).** VO chain (HP 80 Hz, de-ess, +2–3 dB @ 3–5 kHz presence, ~3:1 comp) on `vo_lkmatch`; music ducked via sidechaincompress (ratio ~7:1, attack 20 ms, release 350 ms); music tail rides -6 dB under the end card and resolves on a beat from `beats.json`. **Mandatory two-pass loudnorm**: measure pass → apply with measured values → verify I = -14 ±0.5, TP ≤ -1.0. Commit `phase-6-audio`.

**Phase 7 — Captions.** Word-timed, script-corrected; 1–2 lines ≤32 chars; brand caption style inside safe area. Deliver burned variants + `captions/master.srt` + `.vtt`. Commit `phase-7-captions`.

**Phase 8 — Deliverables matrix.** Render ladder (`scripts/render.sh`, `npm run render:all`): ProRes 422 HQ master (.mov, PCM), H.264 CRF18 9x16, captioned 9x16, 1x1 + 16x9 reframes driven by `reframe/crops.json` (per-shot keyframed crops; preview strips → `docs/proofs/`; **human sign-off required**), :15 cutdown (shots 1→5→8 + end card, beat-snapped), 3 poster JPGs (seal CU, 2031 lineup, red-cap toss). Never upscale: 1x1/16x9 are center-weighted crops of the 1080-wide vertical conform re-rendered from raw where the source allows. Commit `phase-8-deliverables`.

**Phase 9 — QC.** `scripts/qc.py`: stream conformity, duration ±1 frame, loudness, blackdetect/freezedetect, caption spot-check frames at 3 timestamps, safe-area proofs attached, signalstats highlight check. Run by **fresh-context `qc` subagent** (Agent tool, no prior conversation). Hook in `.claude/settings.json`: PostToolUse on Bash commands matching the render script → auto-runs `qc.py`, appends `docs/QC_REPORT.md`. Human checklist appended (⚠️ lines ✓ resolved, media releases for identifiable students **in all aspect ratios**, music license for paid + cutdowns, end-card copy sign-off) — surfaced to user, not self-acknowledged. Commit `phase-9-qc`.

## Skills (.claude/skills/) & Agents (.claude/agents/)

Six skills per protocol: `video-forensics`, `olsm-brand-kit`, `remotion-motion-system`, `audio-post`, `deliverables-matrix`, `av-qc` — each a folder with SKILL.md (when/how, commands, thresholds). Four agents: `editor`, `audio-post`, `motion`, `qc` (qc markdown mandates fresh-context audit posture). `CLAUDE.md` at repo root: brand constants (colors, fonts, banned-phrase list, formation thesis), layout, render commands, QC thresholds.

## Definition of Done / Verification

- `npm run render:all` regenerates every matrix deliverable from source on a clean checkout.
- `qc.py` green on all deliverables; `docs/QC_REPORT.md` includes the human checklist (user acknowledges the release/license items — I cannot).
- `docs/CHANGELOG.md` states v4 improvements over v3: exact -14 LUFS/-1.5 TP loudness (was -14.96/-1.04), real end card, accessibility captions (burned + sidecars), live type instead of baked plates, 1x1/16x9/:15 coverage, LUT-portable grade, full reproducibility.
- End-to-end test: render Master9x16, run QC, frame-grab the three caption spot-checks and end card, deliver the H.264 to chat for the user's eyes.

## Risks & Notes

- Remotion first render on CPU container: expect slow (~2–5× realtime per comp); budgeted, run in background.
- `npm create video` template download ~200 MB node_modules — disk OK.
- If scenedetect disagrees with the authored EDL by >2 frames, authored EDL wins (it generated the master), discrepancy logged.
- Media never pushed to GitHub; reproducibility from a fresh container requires re-downloading sources from the user's Drive (documented in CLAUDE.md § Sources).
