// Script-corrected caption cues (mirrors captions/master.srt). Seconds.
export type Cue = { start: number; end: number; lines: string[] };

export const CUES: Cue[] = [
  { start: 0.4, end: 2.01, lines: ["Not by chance — by formation."] },
  { start: 2.82, end: 5.37, lines: ["Here, character is forged", "in community."] },
  { start: 6.18, end: 8.92, lines: ["Excellence is expected,", "not optional."] },
  { start: 9.15, end: 11.87, lines: ["Faith is lived,", "not merely taught."] },
  { start: 12.33, end: 15.88, lines: ["Class of 2031 —", "you do not arrive as strangers."] },
  { start: 16.1, end: 18.86, lines: ["You arrive as the next chapter", "of a proven tradition."] },
  { start: 19.57, end: 22.46, lines: ["Parents — you are placing your", "child in a safe environment."] },
  { start: 22.62, end: 24.8, lines: ["A place that has already done"] },
  { start: 24.8, end: 26.99, lines: ["this important work", "for generations."] },
  { start: 27.28, end: 28.66, lines: ["Welcome home."] },
];
