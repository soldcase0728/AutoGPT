# CHANGELOG

## v4 (this repo) — over v3 (`source/OLSM_WelcomeHome_v3_LKtone.mp4`)

- **Loudness to spec.** v3 measured -14.96 LUFS / -1.04 dBTP with a VO stem that clipped at +0.08 dBTP. v4 conditions the stem (de-ess + headroom), ducks at 7:1/20ms/350ms, and applies mandatory two-pass loudnorm → verified **-14.43 LUFS / -1.50 dBTP**.
- **Real end card.** 2.6s deep-navy card ("Welcome home." / wordmark), entrance beat-snapped to 29.72s (last beat + one bar @129.2bpm). v3 ended on a fade with a small overlay line.
- **Live type.** "Class of 2031" and all captions are rendered components (tracked fade/rise, brand tokens) instead of baked glow plates — editable per render.
- **Accessibility.** Word-timed, script-corrected captions: burned variant + master.srt/.vtt sidecars. v3 had no captions.
- **Coverage.** New 1x1, 16x9 (blurred-pillarbox, no upscale), and beat-snapped :15 cutdown with its own loudnormed mix. v3 was 9:16 only.
- **Portable grade.** The v3 look exported as `luts/olsm_warm.cube` (validated 47dB PSNR against the original filter chain); bloom/vignette/grain preserved as explicit steps.
- **Reproducibility.** Timeline-as-code (Remotion EDL), phase-gated git history, one-command render ladder, automated QC with post-render hook, skills + subagents for future sessions.
