// Authored EDL — mirrors analysis/edl.csv. Times in seconds on the master timeline.
// srcW/srcH: native clip size. cropX/cropW: horizontal window conformed to 9:16
// (scale = 1920/srcH; cropW * scale === 1080).
export type Shot = {
  id: string;
  src: string;
  srcW: number;
  srcH: number;
  cropX: number;
  cropW: number;
  trimStartS: number; // seek into source
  rate: number; // playbackRate (clip6 pre-slowed to 1.0 via clip6_slow.mp4)
  tlStartS: number; // boundary start (dissolve straddles it by ±0.35s)
  tlEndS: number;
};

export const DISSOLVE_S = 0.7;

export const SHOTS: Shot[] = [
  { id: "seal", src: "clip1_seal.mp4", srcW: 1168, srcH: 768, cropX: 360, cropW: 432, trimStartS: 0.0, rate: 1, tlStartS: 0.0, tlEndS: 2.92 },
  { id: "quad", src: "clip2_animate.mp4", srcW: 1280, srcH: 720, cropX: 540, cropW: 405, trimStartS: 0.0, rate: 1, tlStartS: 2.92, tlEndS: 6.04 },
  { id: "podium", src: "clip4.mp4", srcW: 816, srcH: 1104, cropX: 195, cropW: 621, trimStartS: 0.5, rate: 1, tlStartS: 6.04, tlEndS: 9.0 },
  { id: "cross", src: "clip9.mp4", srcW: 1280, srcH: 720, cropX: 430, cropW: 405, trimStartS: 0.5, rate: 1, tlStartS: 9.0, tlEndS: 12.1 },
  { id: "brothers", src: "clip6_slow.mp4", srcW: 768, srcH: 1168, cropX: 55, cropW: 657, trimStartS: 0.0, rate: 1, tlStartS: 12.1, tlEndS: 19.3 },
  { id: "choir", src: "clip3.mp4", srcW: 1168, srcH: 768, cropX: 350, cropW: 432, trimStartS: 0.3, rate: 1, tlStartS: 19.3, tlEndS: 23.05 },
  { id: "historic", src: "clip5.mp4", srcW: 1168, srcH: 768, cropX: 368, cropW: 432, trimStartS: 0.0, rate: 1.33, tlStartS: 23.05, tlEndS: 26.9 },
  { id: "capsGirls", src: "clip7.mp4", srcW: 1168, srcH: 784, cropX: 364, cropW: 441, trimStartS: 1.3, rate: 1, tlStartS: 26.9, tlEndS: 28.6 },
  { id: "capsBoys", src: "clip10.mp4", srcW: 1168, srcH: 768, cropX: 380, cropW: 432, trimStartS: 0.8, rate: 1, tlStartS: 28.6, tlEndS: 30.4 },
];
