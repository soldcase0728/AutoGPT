#!/bin/bash
# audio-post: stems -> mastered 33.0s mix at -14 LUFS / <=-1.5 dBTP (two-pass).
# VO stem: source/audio/vo_bill.wav (LK-paced, sentence-seated; arrives with
# clipped peaks at +0.08 dBTP -> de-essed and ceilinged here before the mix).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
DUR=33.0

# 1) VO conditioning: de-ess, restore headroom, pad to master duration.
ffmpeg -y -v error -i source/audio/vo_bill.wav -af \
  "deesser=i=0.25,apad=whole_dur=${DUR}" \
  /tmp/vo_cond.wav

# 2) Music bed: licensed FPC V4, -6 dB ride under the end card (t>=29.7),
#    natural resolution ~29.6s; padded to DUR.
ffmpeg -y -v error -i "source/audio/For Positive Classic V4.wav" -af \
  "atrim=0.4:33.4,asetpts=PTS-STARTPTS,aresample=48000,volume=0.32,\
afade=t=in:st=0:d=0.8,volume=enable='gte(t,29.7)':volume=0.5,apad=whole_dur=${DUR}" \
  /tmp/mus_bed.wav

# 3) Sidechain duck (protocol: ratio ~7:1, attack 20ms, release 350ms).
ffmpeg -y -v error -i /tmp/mus_bed.wav -i /tmp/vo_cond.wav -filter_complex \
  "sidechaincompress=threshold=0.02:ratio=7:attack=20:release=350" \
  -t $DUR /tmp/mus_duck.wav

# 4) Sum.
ffmpeg -y -v error -i /tmp/vo_cond.wav -i /tmp/mus_duck.wav -filter_complex \
  "amix=inputs=2:duration=first:normalize=0" -t $DUR /tmp/mix_raw.wav

# 5) Two-pass loudnorm: measure, then apply with measured values (linear mode).
M=$(ffmpeg -v info -i /tmp/mix_raw.wav -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
II=$(echo "$M" | grep input_i | grep -oE '[-0-9.]+')
TP=$(echo "$M" | grep input_tp | grep -oE '[-0-9.]+')
LRA=$(echo "$M" | grep input_lra | grep -oE '[-0-9.]+' | head -1)
TH=$(echo "$M" | grep input_thresh | grep -oE '[-0-9.]+')
ffmpeg -y -v error -i /tmp/mix_raw.wav -af \
  "loudnorm=I=-14:TP=-1.5:LRA=7:measured_I=${II}:measured_TP=${TP}:measured_LRA=${LRA}:measured_thresh=${TH}:linear=true,aresample=48000" \
  deliverables/mix_v4.wav

# 6) Verify.
ffmpeg -v info -i deliverables/mix_v4.wav -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p' | grep -E 'input_i|input_tp'
