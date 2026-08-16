#!/bin/bash
# audio-post: music-only master, 33.0s at -14 LUFS / <=-1.5 dBTP (two-pass).
# v6: no narration per user direction — the Emotional Piano & Cello bed IS the
# soundtrack. No VO conditioning, no sidechain duck.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
DUR=33.0

# 1) Music bed: same 33s window as the v5 picture edit; gentle in-fade and a
#    2s out-fade so the close resolves instead of cutting.
ffmpeg -y -v error -i "source/audio/Emotional Piano & Cello V3.wav" -af \
  "atrim=5.4:38.4,asetpts=PTS-STARTPTS,aresample=48000,\
afade=t=in:st=0:d=0.8,afade=t=out:st=31.0:d=2.0,apad=whole_dur=${DUR}" \
  -t $DUR /tmp/mix_raw.wav

# 5) Two-pass loudnorm: measure, then apply with measured values (linear mode).
M=$(ffmpeg -v info -i /tmp/mix_raw.wav -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
II=$(echo "$M" | grep input_i | grep -oE '[-0-9.]+')
TP=$(echo "$M" | grep input_tp | grep -oE '[-0-9.]+')
LRA=$(echo "$M" | grep input_lra | grep -oE '[-0-9.]+' | head -1)
TH=$(echo "$M" | grep input_thresh | grep -oE '[-0-9.]+')
ffmpeg -y -v error -i /tmp/mix_raw.wav -af \
  "loudnorm=I=-14:TP=-1.5:LRA=7:measured_I=${II}:measured_TP=${TP}:measured_LRA=${LRA}:measured_thresh=${TH}:linear=true,aresample=48000" \
  deliverables/mix_v4.wav

# 6) Exact-gain correction (linear loudnorm can undershoot protecting TP).
I2=$(ffmpeg -v info -i deliverables/mix_v4.wav -af loudnorm=print_format=json -f null - 2>&1 | grep '"input_i"' | grep -oE '[-0-9.]+' | head -1)
GAIN=$(python3 -c "g=round(-14.0-(${I2}),2); print(g if g>0 else 0)")
if [ "$GAIN" != "0" ]; then
  ffmpeg -y -v error -i deliverables/mix_v4.wav -af "volume=${GAIN}dB,alimiter=limit=0.84:level=false" /tmp/mix_corr.wav
  mv /tmp/mix_corr.wav deliverables/mix_v4.wav
fi

# 7) Verify.
ffmpeg -v info -i deliverables/mix_v4.wav -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p' | grep -E 'input_i|input_tp'
