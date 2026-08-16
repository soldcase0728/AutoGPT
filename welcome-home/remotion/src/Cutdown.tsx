import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { SHOTS, DISSOLVE_S, Shot } from "./edl";
import { COLORS, FONTS, FPS } from "./brand";
import { Master } from "./Master";

const f = (s: number) => Math.round(s * FPS);

// :15 cutdown — shots 1 (seal), 5 (brothers), 8+9 (tosses) + end card.
// Edit points snapped to the 129.2bpm grid (beat = 0.4644s):
// seal 0–2.79 (6 beats), brothers 2.79–7.43 (10), girls 7.43–9.29 (4),
// boys 9.29–11.15 (4), end card in @11.61 (beat 25), out 15.0.
const PLAN: { shot: Shot; from: number; dur: number; trimS?: number }[] = [
  { shot: SHOTS[0], from: 0, dur: f(2.79 + DISSOLVE_S / 2) },
  { shot: SHOTS[4], from: f(2.79 - DISSOLVE_S / 2), dur: f(4.64 + DISSOLVE_S) },
  { shot: SHOTS[7], from: f(7.43 - DISSOLVE_S / 2), dur: f(1.86 + DISSOLVE_S) },
  { shot: SHOTS[8], from: f(9.29 - DISSOLVE_S / 2), dur: f(1.86 + DISSOLVE_S) },
];

import { OffthreadVideo, staticFile, useVideoConfig } from "remotion";
const Clip: React.FC<{ shot: Shot; fadeIn: boolean }> = ({ shot, fadeIn }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const scale = height / shot.srcH;
  const opacity = fadeIn ? interpolate(frame, [0, f(DISSOLVE_S)], [0, 1], { extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <OffthreadVideo
        muted
        src={staticFile(shot.src)}
        startFrom={f(shot.trimStartS)}
        playbackRate={shot.rate}
        style={{
          position: "absolute",
          width: shot.srcW * scale,
          height: shot.srcH * scale,
          left: -shot.cropX * scale,
          top: 0,
          maxWidth: "none",
        }}
      />
    </AbsoluteFill>
  );
};

const EndCard15: React.FC = () => {
  const frame = useCurrentFrame();
  const inF = f(11.61);
  const o = interpolate(frame, [inF, inF + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navy, opacity: o, alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: FONTS.display, fontSize: 96, color: COLORS.ivory, marginBottom: 36 }}>Welcome home.</div>
      <div style={{ fontFamily: FONTS.caption, fontWeight: 600, fontSize: 40, letterSpacing: "0.32em", color: COLORS.ivory, paddingLeft: "0.32em" }}>
        ORCHARD LAKE ST. MARY&rsquo;S
      </div>
    </AbsoluteFill>
  );
};

export const Cutdown: React.FC = () => {
  const frame = useCurrentFrame();
  const openFade = interpolate(frame, [0, f(0.6)], [1, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {PLAN.map((p, i) => (
        <Sequence key={i} from={p.from} durationInFrames={p.dur} layout="none">
          <Clip shot={p.shot} fadeIn={i !== 0} />
        </Sequence>
      ))}
      <EndCard15 />
      <AbsoluteFill style={{ backgroundColor: "black", opacity: openFade, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

export const CUTDOWN_FRAMES = f(15.0);
