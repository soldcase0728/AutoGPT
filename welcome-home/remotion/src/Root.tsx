import React from "react";
import { Composition, staticFile } from "remotion";
import { continueRender, delayRender } from "remotion";
import { Master, MASTER_FRAMES } from "./Master";
import { Cutdown, CUTDOWN_FRAMES } from "./Cutdown";
import { FPS, W, H } from "./brand";

// Load brand fonts from source/brand (exposed via public/ symlinks).
const loadFonts = () => {
  const handle = delayRender("fonts");
  Promise.all(
    [
      new FontFace("Playfair Display", `url(${staticFile("Playfair900.ttf")})`).load(),
      new FontFace("Playfair Medium", `url(${staticFile("Playfair500.ttf")})`).load(),
      new FontFace("Montserrat", `url(${staticFile("Montserrat.ttf")})`).load(),
    ].map((p) => p.then((f) => document.fonts.add(f)))
  ).then(() => continueRender(handle));
};
if (typeof document !== "undefined") loadFonts();

export const Root: React.FC = () => (
  <>
    <Composition id="Master9x16" component={Master} durationInFrames={MASTER_FRAMES} fps={FPS} width={W} height={H} />
    <Composition
      id="Master9x16SafeProof"
      component={Master}
      durationInFrames={MASTER_FRAMES}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{ safeOverlay: true }}
    />
    <Composition id="Cutdown15s" component={Cutdown} durationInFrames={CUTDOWN_FRAMES} fps={FPS} width={W} height={H} />
  </>
);
