---
name: deliverables-matrix
description: The render ladder and naming convention for every OLSM deliverable. Run scripts/render.sh (or npm run render:all from remotion/); QC auto-runs via hook.
---
# deliverables-matrix
Ladder: Remotion clean ProRes → grade.sh (LUT + bloom/vignette/grain) → mux mix → encode.
| File | Spec |
|---|---|
| WelcomeHome_v4_master_9x16.mov | ProRes 422 HQ 1080x1920, PCM |
| WelcomeHome_v4_9x16[.captioned].mp4 | H.264 High CRF18 ≤12Mbps, AAC192, faststart |
| WelcomeHome_v4_1x1.mp4 | 1080x1080, crops from reframe/crops.json (human sign-off) |
| WelcomeHome_v4_16x9.mp4 | 1280x720 blurred-pillarbox (no upscale) |
| WelcomeHome_v4_15s.mp4 | :15 cutdown, beat-snapped, own loudnormed mix |
| poster_01..03.jpg | seal CU / 2031 lineup / cap toss |
Never upscale a rendered deliverable. Reframes are drafts until proof strips are signed off.
