---
name: audio-post
description: VO conditioning, music ducking, and mandatory two-pass loudness normalization for all OLSM deliverables. Run scripts/audio_post.sh; verify -14 LUFS / ≤-1.0 dBTP.
---
# audio-post
- scripts/audio_post.sh builds deliverables/mix_v4.wav from stems (VO + licensed music).
- Chain: de-ess → headroom limiter (0.85, level=false) → sidechain duck 7:1 (attack 20ms, release 350ms) → music -6 dB ride under end card → two-pass loudnorm (measure, then apply with measured_* values, linear=true).
- Gate: integrated -14 ±0.5 LUFS, true peak ≤ -1.0 dBTP. Never ship on a single-pass loudnorm.
- Cutdown audio is rebuilt per edit (see render.sh step 7), never trimmed from the master mix.
