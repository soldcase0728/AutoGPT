#!/bin/bash
# Picture post pass: portable color via LUT + non-LUT-able finishing (bloom,
# vignette, grain) — identical look to the v3 chain (validated 47dB PSNR).
# Usage: grade.sh <in> <out> [extra ffmpeg output args...]
set -euo pipefail
IN="$1"; OUT="$2"; shift 2
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ffmpeg -y -v error -i "$IN" -vf "\
lut3d=$DIR/luts/olsm_warm.cube,\
split[ba][bb];[bb]gblur=sigma=22[bl];[ba][bl]blend=all_mode=screen:all_opacity=0.14,\
vignette=a=PI/7.5,\
noise=alls=4:allf=t+u" \
  "$@" "$OUT"
