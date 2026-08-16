#!/bin/bash
# deliverables-matrix: render ladder. All deliverables derive from the Remotion
# comps + grade.sh + mix_v4.wav. Never re-upscale a rendered deliverable.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
mkdir -p deliverables /tmp/wh
G="scripts/grade.sh"

echo "=== [1/8] Remotion clean renders"
( cd remotion && npx remotion render Master9x16 /tmp/wh/master_clean.mov --codec=prores --prores-profile=hq --log=error )
( cd remotion && npx remotion render Master9x16Captioned /tmp/wh/master_capt_clean.mov --codec=prores --prores-profile=hq --log=error )
( cd remotion && npx remotion render Cutdown15s /tmp/wh/cutdown_clean.mov --codec=prores --prores-profile=hq --log=error )

echo "=== [2/8] Grade pass"
bash $G /tmp/wh/master_clean.mov /tmp/wh/master_graded.mov -c:v prores_ks -profile:v 3
bash $G /tmp/wh/master_capt_clean.mov /tmp/wh/master_capt_graded.mov -c:v prores_ks -profile:v 3
bash $G /tmp/wh/cutdown_clean.mov /tmp/wh/cutdown_graded.mov -c:v prores_ks -profile:v 3

echo "=== [3/8] ProRes archive master (PCM audio)"
ffmpeg -y -v error -i /tmp/wh/master_graded.mov -i deliverables/mix_v4.wav \
  -map 0:v -map 1:a -c:v copy -c:a pcm_s16le "deliverables/WelcomeHome_v4_master_9x16.mov"

echo "=== [4/8] H.264 socials (clean + captioned)"
ffmpeg -y -v error -i /tmp/wh/master_graded.mov -i deliverables/mix_v4.wav -map 0:v -map 1:a \
  -c:v libx264 -profile:v high -crf 18 -maxrate 12M -bufsize 24M -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "deliverables/WelcomeHome_v4_9x16.mp4"
ffmpeg -y -v error -i /tmp/wh/master_capt_graded.mov -i deliverables/mix_v4.wav -map 0:v -map 1:a \
  -c:v libx264 -profile:v high -crf 18 -maxrate 12M -bufsize 24M -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "deliverables/WelcomeHome_v4_9x16_captioned.mp4"

echo "=== [5/8] 1x1 reframe (crops.json keyframes) + proof strip"
FILT=$(python3 - << 'PY'
import json
crops = json.load(open("reframe/crops.json"))["shots"]
parts = []
for c in crops:
    a, b = c["tl"]
    parts.append(f"between(t,{a},{b})*{c['y']}")
expr = "+".join(parts)
print(f"crop=1080:1080:0:'{expr}'")
PY
)
ffmpeg -y -v error -i /tmp/wh/master_graded.mov -i deliverables/mix_v4.wav -map 0:v -map 1:a \
  -vf "$FILT" -c:v libx264 -profile:v high -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "deliverables/WelcomeHome_v4_1x1.mp4"
ffmpeg -y -v error -i "deliverables/WelcomeHome_v4_1x1.mp4" \
  -vf "fps=1/3,scale=270:270,tile=11x1" -frames:v 1 docs/proofs/reframe_1x1_strip.png

echo "=== [6/8] 16x9 site variant (1280x720, blurred pillarbox — no upscale)"
ffmpeg -y -v error -i /tmp/wh/master_graded.mov -i deliverables/mix_v4.wav -map "[v]" -map 1:a \
  -filter_complex "[0:v]split[a][b];[a]scale=1280:720,gblur=sigma=40,eq=brightness=-0.08[bg];[b]scale=-2:720[fg];[bg][fg]overlay=(W-w)/2:0[v]" \
  -c:v libx264 -profile:v high -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "deliverables/WelcomeHome_v4_16x9.mp4"

echo "=== [7/8] :15 cutdown (beat-snapped) + audio"
ffmpeg -y -v error -i "source/audio/vo_bill.wav" -af "atrim=0.0:2.65,asetpts=PTS-STARTPTS" /tmp/wh/cd_s1.wav
ffmpeg -y -v error -i "source/audio/vo_bill.wav" -af "atrim=11.95:16.17,asetpts=PTS-STARTPTS" /tmp/wh/cd_s5.wav
ffmpeg -y -v error -i "source/audio/vo_bill.wav" -af "atrim=26.93:28.6,asetpts=PTS-STARTPTS" /tmp/wh/cd_s9.wav
ffmpeg -y -v error \
  -i /tmp/wh/cd_s1.wav -i /tmp/wh/cd_s5.wav -i /tmp/wh/cd_s9.wav \
  -i "source/audio/Emotional Piano & Cello V4.wav" -filter_complex "\
[0:a]adelay=400|400[v1];[1:a]adelay=2600|2600[v2];[2:a]adelay=11630|11630[v3];\
[v1][v2][v3]amix=inputs=3:duration=longest:normalize=0,apad=whole_dur=15.0,asplit=2[vo][vok];\
[3:a]atrim=0.5:15.5,asetpts=PTS-STARTPTS,aresample=48000,volume=0.40,afade=t=in:st=0:d=0.6,apad=whole_dur=15.0[mus];\
[mus][vok]sidechaincompress=threshold=0.02:ratio=7:attack=20:release=350[md];\
[vo][md]amix=inputs=2:duration=first:normalize=0[premix]" \
  -map "[premix]" -t 15.0 /tmp/wh/cd_mix_raw.wav
M=$(ffmpeg -v info -i /tmp/wh/cd_mix_raw.wav -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
II=$(echo "$M" | grep input_i | grep -oE '[-0-9.]+'); TP=$(echo "$M" | grep input_tp | grep -oE '[-0-9.]+')
LRA=$(echo "$M" | grep input_lra | grep -oE '[-0-9.]+' | head -1); TH=$(echo "$M" | grep input_thresh | grep -oE '[-0-9.]+')
ffmpeg -y -v error -i /tmp/wh/cd_mix_raw.wav -af "loudnorm=I=-14:TP=-1.5:LRA=7:measured_I=${II}:measured_TP=${TP}:measured_LRA=${LRA}:measured_thresh=${TH}:linear=true" /tmp/wh/cd_mix_pre.wav
# exact-gain correction: linear loudnorm can undershoot while protecting TP
I2=$(ffmpeg -v info -i /tmp/wh/cd_mix_pre.wav -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1 | grep input_i | grep -oE '[-0-9.]+')
GAIN=$(python3 -c "print(round(-14.0 - (${I2}), 2))")
ffmpeg -y -v error -i /tmp/wh/cd_mix_pre.wav -af "volume=${GAIN}dB,alimiter=limit=0.84:level=false" /tmp/wh/cd_mix.wav
ffmpeg -y -v error -i /tmp/wh/cutdown_graded.mov -i /tmp/wh/cd_mix.wav -map 0:v -map 1:a \
  -c:v libx264 -profile:v high -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart \
  "deliverables/WelcomeHome_v4_15s.mp4"

echo "=== [8/8] Posters"
ffmpeg -y -v error -ss 1.4 -i /tmp/wh/master_graded.mov -frames:v 1 -q:v 2 deliverables/poster_01_seal.jpg
ffmpeg -y -v error -ss 14.0 -i /tmp/wh/master_graded.mov -frames:v 1 -q:v 2 deliverables/poster_02_2031.jpg
ffmpeg -y -v error -ss 27.6 -i /tmp/wh/master_graded.mov -frames:v 1 -q:v 2 deliverables/poster_03_captoss.jpg
cp captions/master.srt captions/master.vtt deliverables/ 2>/dev/null || true
echo "RENDER LADDER COMPLETE"
ls -la deliverables/
