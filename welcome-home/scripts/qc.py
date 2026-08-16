#!/usr/bin/env python3
"""av-qc: automated QC gates for the deliverables matrix.

Usage: qc.py [--append docs/QC_REPORT.md]
Exits non-zero if any hard gate fails. Designed to run from repo root
(the post-render hook and the qc subagent both call it).
"""
import json, subprocess, sys, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
FPS = 30.0
FRAME = 1.0 / FPS

SPECS = {
    "deliverables/WelcomeHome_v4_master_9x16.mov": dict(w=1080, h=1920, dur=33.0, vcodec="prores", acodec="pcm_s16le"),
    "deliverables/WelcomeHome_v4_9x16.mp4": dict(w=1080, h=1920, dur=33.0, vcodec="h264", pix="yuv420p", faststart=True),
    "deliverables/WelcomeHome_v4_9x16_captioned.mp4": dict(w=1080, h=1920, dur=33.0, vcodec="h264", pix="yuv420p", faststart=True),
    "deliverables/WelcomeHome_v4_1x1.mp4": dict(w=1080, h=1080, dur=33.0, vcodec="h264", pix="yuv420p", faststart=True),
    "deliverables/WelcomeHome_v4_16x9.mp4": dict(w=1280, h=720, dur=33.0, vcodec="h264", pix="yuv420p", faststart=True),
    "deliverables/WelcomeHome_v4_15s.mp4": dict(w=1080, h=1920, dur=15.0, vcodec="h264", pix="yuv420p", faststart=True),
}
CAPTION_SPOTS = [(4.0, "forged in community"), (13.5, "strangers"), (27.6, "Welcome home")]

results, failures = [], []

def probe(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", f],
                       capture_output=True, text=True)
    return json.loads(r.stdout)

def loudness(f):
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", f, "-af",
                        "loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    s = r.stderr
    blob = s[s.rfind("{"):s.rfind("}") + 1]
    d = json.loads(blob)
    return float(d["input_i"]), float(d["input_tp"])

def detect(f, filt, token):
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", f, "-vf", filt, "-an", "-f", "null", "-"],
                       capture_output=True, text=True)
    return [l for l in r.stderr.splitlines() if token in l]

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    if not ok:
        failures.append(name)

for f, spec in SPECS.items():
    if not os.path.exists(f):
        check(f"{f}: exists", False, "MISSING")
        continue
    p = probe(f)
    v = next(s for s in p["streams"] if s["codec_type"] == "video")
    a = next((s for s in p["streams"] if s["codec_type"] == "audio"), None)
    dur = float(p["format"]["duration"])
    check(f"{f}: resolution", v["width"] == spec["w"] and v["height"] == spec["h"], f'{v["width"]}x{v["height"]}')
    check(f"{f}: codec", spec["vcodec"] in v["codec_name"], v["codec_name"])
    if "pix" in spec:
        check(f"{f}: pix_fmt", v["pix_fmt"] == spec["pix"], v["pix_fmt"])
    check(f"{f}: duration", abs(dur - spec["dur"]) <= FRAME + 0.05, f"{dur:.3f}s vs {spec['dur']}s")
    if "acodec" in spec and a is not None:
        check(f"{f}: audio codec", spec["acodec"] in a["codec_name"], a["codec_name"])
    if spec.get("faststart") and f.endswith(".mp4"):
        head = open(f, "rb").read(4096)
        check(f"{f}: faststart", b"moov" in head, "moov in head" if b"moov" in head else "moov not leading")
    i, tp = loudness(f)
    check(f"{f}: loudness I", abs(i + 14.0) <= 0.5, f"{i:.2f} LUFS")
    check(f"{f}: true peak", tp <= -1.0, f"{tp:.2f} dBTP")
    card_in = 29.5 if spec["dur"] > 20 else 11.4  # end card (navy, intended dark)
    blk = []
    for l in detect(f, "blackdetect=d=0.4:pix_th=0.08", "black_start"):
        st = float(l.split("black_start:")[1].split()[0])
        if st > 0.05 and st < card_in:  # whitelist opening fade + end card
            blk.append(l)
    check(f"{f}: no unintended black", len(blk) == 0, "; ".join(blk[:2]))
    frz = detect(f, "freezedetect=n=-60dB:d=1.2", "freeze_start")
    # end card (static by design) sits after 29.7s on 33s cuts, 11.6s on the :15
    limit = 29.0 if spec["dur"] > 20 else 11.0
    frz_bad = [l for l in frz if float(l.split("freeze_start:")[1].split()[0]) < limit]
    check(f"{f}: no unintended freeze", len(frz_bad) == 0, "; ".join(frz_bad[:2]))

# Caption sync spot-check grabs (human-verifiable stills)
cap = "deliverables/WelcomeHome_v4_9x16_captioned.mp4"
if os.path.exists(cap):
    for t, expected in CAPTION_SPOTS:
        out = f"docs/proofs/qc_caption_{str(t).replace('.','_')}.png"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", cap, "-frames:v", "1", out])
        check(f"caption spot {t}s ('{expected}')", os.path.exists(out), out)

check("sidecar SRT", os.path.exists("captions/master.srt"))
check("sidecar VTT", os.path.exists("captions/master.vtt"))
check("safe-area proofs", len([f for f in os.listdir("docs/proofs") if f.startswith("safe_")]) >= 3)

stamp = datetime.datetime.now().isoformat(timespec="seconds")
lines = [f"\n## QC run {stamp}\n"]
for name, ok, detail in results:
    lines.append(f"- {'PASS' if ok else 'FAIL'} — {name}" + (f" ({detail})" if detail else ""))
lines.append(f"\n**Result: {'ALL GATES PASS' if not failures else f'{len(failures)} FAILURE(S)'}**\n")
lines.append("""### Human checklist (must be acknowledged by a human — not the agent)
- [ ] ⚠️ transcript lines confirmed (captions corrected to script per kickoff)
- [ ] media releases confirmed for all identifiable students in ALL aspect ratios
- [ ] music license confirmed for paid placements + cutdowns
- [ ] brand/Archdiocese sign-off on end-card copy
- [ ] 1x1 reframe crops signed off (docs/proofs/reframe_1x1_strip.png)
""")
report = "\n".join(lines)
if "--append" in sys.argv:
    path = sys.argv[sys.argv.index("--append") + 1]
    open(path, "a").write(report)
print(report)
sys.exit(1 if failures else 0)
