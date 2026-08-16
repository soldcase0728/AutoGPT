---
name: remotion-motion-system
description: Title, caption, and end-card components + safe-area proofing for OLSM films. Use when adding or changing any on-screen type or composition.
---
# remotion-motion-system
- Components live in remotion/src/Master.tsx: Title2031 (6–8 frame tracked fade/rise), Captions (scrim, ≤32 chars/line, inside safe area), EndCard (navy, beat-snapped entrance), SafeAreaOverlay.
- EDL is data: remotion/src/edl.ts mirrors analysis/edl.csv. Conform math: scale = compH/srcH; crop via negative left offset. Slow-mo sources are pre-interpolated with ffmpeg minterpolate (Remotion frame-duplicates otherwise).
- Proof stills: `npx remotion still Master9x16SafeProof --frame=<f> docs/proofs/<name>.png` — render one per deliverable after any type change.
- No bounces, no glows, no template energy. Restraint is the look.
