// olsm-brand-kit — single source of truth. Colors sampled from analysis/palette.json.
export const COLORS = {
  red: "#B32C1C", // shot-8 cap-toss dominant
  navy: "#101823",
  ivory: "#F4EFE6",
  sepiaAmber: "#B37C4D", // archival only
};

export const FONTS = {
  display: "Playfair Display", // Playfair900.ttf
  displayMedium: "Playfair Medium", // Playfair500.ttf
  caption: "Montserrat", // Montserrat.ttf (SemiBold)
};

export const SAFE = { top: 220, bottom: 320, side: 60 }; // px @1080x1920

export const BANNED_PHRASES = [
  "world-class",
  "state-of-the-art",
  "like family",
  "excellence in education",
];

// Formation thesis (voice rules): declarative, unhurried, no exclamation
// points, no superlatives; the institution speaks with quiet confidence.
export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const PICTURE_END_S = 30.4;
export const ENDCARD_IN_S = 29.72; // beat-snapped: last beat 27.86 + 1 bar @129.2bpm
export const MASTER_DUR_S = 33.0;
