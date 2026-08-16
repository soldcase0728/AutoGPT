import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SHOTS, DISSOLVE_S, Shot } from "./edl";
import { CUES } from "./captions";
import { COLORS, FONTS, SAFE, FPS, ENDCARD_IN_S, MASTER_DUR_S } from "./brand";

const f = (s: number) => Math.round(s * FPS);

// One conformed shot: source cropped horizontally, filling 1080x1920 (or the
// comp's frame box for other aspects — box math stays relative to 9:16 conform).
const VideoShot: React.FC<{ shot: Shot; fadeIn: boolean }> = ({ shot, fadeIn }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const scale = height / shot.srcH;
  const opacity = fadeIn
    ? interpolate(frame, [0, f(DISSOLVE_S)], [0, 1], { extrapolateRight: "clamp" })
    : 1;
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

const Title2031: React.FC = () => {
  const frame = useCurrentFrame();
  const inF = f(12.4), outF = f(15.6), rise = 8;
  const o = interpolate(frame, [inF, inF + rise, outF, outF + rise], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [inF, inF + rise], [14, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 430 + y,
          opacity: o,
          fontFamily: FONTS.caption,
          fontWeight: 600,
          fontSize: 64,
          letterSpacing: "0.06em",
          color: "white",
          textShadow: "0 3px 18px rgba(0,0,0,0.55)",
        }}
      >
        Class of 2031
      </div>
    </AbsoluteFill>
  );
};

// Cinematic caption style: no box — ivory Playfair over a soft full-width
// gradient scrim, so the type sits IN the image instead of on a gray card.
const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cue = CUES.find((c) => t >= c.start && t <= c.end);
  if (!cue) return null;
  const o = interpolate(t, [cue.start, cue.start + 0.2, cue.end - 0.2, cue.end], [0, 1, 1, 0]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: SAFE.bottom + 260,
          opacity: o,
          background: "linear-gradient(to top, rgba(8,10,14,0.55), rgba(8,10,14,0) 85%)",
        }}
      />
      <div
        style={{
          marginBottom: SAFE.bottom + 44,
          opacity: o,
          textAlign: "center",
          fontFamily: FONTS.displayMedium,
          fontSize: 47,
          lineHeight: 1.38,
          letterSpacing: "0.012em",
          color: COLORS.ivory,
          textShadow: "0 2px 26px rgba(0,0,0,0.8), 0 1px 5px rgba(0,0,0,0.55)",
          maxWidth: 1080 - SAFE.side * 2,
        }}
      >
        {cue.lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const inF = f(ENDCARD_IN_S), rise = 18;
  const o = interpolate(frame, [inF, inF + rise], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sub = interpolate(frame, [inF + 10, inF + 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.navy, opacity: o, alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          fontFamily: FONTS.display,
          fontSize: 96,
          color: COLORS.ivory,
          marginBottom: 36,
        }}
      >
        Welcome home.
      </div>
      <div
        style={{
          opacity: sub,
          fontFamily: FONTS.caption,
          fontWeight: 600,
          fontSize: 40,
          letterSpacing: "0.32em",
          color: COLORS.ivory,
          paddingLeft: "0.32em",
        }}
      >
        ORCHARD LAKE ST. MARY&rsquo;S
      </div>
    </AbsoluteFill>
  );
};

export const SafeAreaOverlay: React.FC = () => (
  <AbsoluteFill>
    <div
      style={{
        position: "absolute",
        top: SAFE.top,
        bottom: SAFE.bottom,
        left: SAFE.side,
        right: SAFE.side,
        border: "3px dashed rgba(255,60,60,0.85)",
      }}
    />
  </AbsoluteFill>
);

export const Master: React.FC<{ captions?: boolean; safeOverlay?: boolean }> = ({
  captions = false,
  safeOverlay = false,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {SHOTS.map((s, i) => {
        const from = i === 0 ? 0 : f(s.tlStartS - DISSOLVE_S / 2);
        const end = f(Math.min(s.tlEndS + DISSOLVE_S / 2, 30.4));
        return (
          <Sequence key={s.id} from={from} durationInFrames={end - from} layout="none">
            <VideoShot shot={s} fadeIn={i !== 0} />
          </Sequence>
        );
      })}
      <Title2031 />
      {captions ? <Captions /> : null}
      <EndCard />
      {safeOverlay ? <SafeAreaOverlay /> : null}
      {/* opening fade-in from black */}
      <OpeningFade />
    </AbsoluteFill>
  );
};

const OpeningFade: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, f(0.8)], [1, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "black", opacity: o, pointerEvents: "none" }} />;
};

export const MASTER_FRAMES = f(MASTER_DUR_S);
