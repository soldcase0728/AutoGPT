---
name: video-forensics
description: One-command forensic ingest of any source video — ffprobe JSON, scene detection, word-level transcript, loudness, beat grid, per-shot palette. Use before editing any new footage.
---
# video-forensics
Run from repo root against any source file:
1. `ffprobe -v error -show_format -show_streams -of json <src> > analysis/probe.json`
2. `python3 -c "from scenedetect import detect, AdaptiveDetector; ..."` → shot list (see analysis/scenedetect_validation.txt for the pattern). Dissolves are invisible to detectors — authored EDLs win.
3. faster-whisper (`small`/`medium`, `word_timestamps=True`) → analysis/transcript.json. Diff against script; surface discrepancies before captions burn.
4. Loudness: `ffmpeg -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null -` + astats → analysis/audio.json.
5. Beats: `librosa.beat.beat_track` → analysis/beats.json (snap end cards/cutdowns to this grid).
6. Palette: 1 frame/shot → PIL quantize → analysis/palette.json; check signalstats for clipped highlights.
