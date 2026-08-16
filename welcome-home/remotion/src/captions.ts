// Script-corrected caption cues (mirrors captions/master.srt). Seconds.
// Bill Oxley read — 8 sentences; the Parents line is not in this script,
// so the choir beat (19.3–23.05) plays as an instrumental breath.
export type Cue = { start: number; end: number; lines: string[] };

export const CUES: Cue[] = [
  { start: 0.4, end: 2.3, lines: ["Not by chance — by formation."] },
  { start: 3.04, end: 5.6, lines: ["Here, character is forged", "in community."] },
  { start: 6.38, end: 8.45, lines: ["Excellence is expected,", "not optional."] },
  { start: 9.32, end: 11.35, lines: ["Faith is lived,", "not merely taught."] },
  { start: 12.37, end: 16.1, lines: ["Class of 2031 —", "you do not arrive as strangers."] },
  { start: 16.58, end: 19.55, lines: ["You arrive as the next chapter", "of a proven tradition."] },
  { start: 23.3, end: 24.7, lines: ["It's a place that has already"] },
  { start: 24.7, end: 26.7, lines: ["done this important work", "for generations."] },
  { start: 27.5, end: 28.65, lines: ["Welcome home."] },
];
