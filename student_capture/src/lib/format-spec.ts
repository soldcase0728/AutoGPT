import type { FormatSpec } from "./types";

export interface MediaFacts {
  kind: "video" | "photo";
  durationSeconds?: number;
  width?: number;
  height?: number;
  bytes: number;
}

/** Smaller than this is not a real clip. */
export const MIN_VIDEO_BYTES = 50_000;

export interface FormatFinding {
  /** `block` stops submission; `warn` is shown but does not. */
  level: "block" | "warn";
  message: string;
}

/**
 * Craft rules are soft by design: a student on a deadline should never be told
 * "no" by a linter. Only what makes the capture unusable blocks: the wrong
 * medium, a file too large to accept, and a video that can't be read.
 */
export function checkFormat(
  spec: FormatSpec,
  facts: MediaFacts,
  maxBytes: number,
): FormatFinding[] {
  const findings: FormatFinding[] = [];

  if (facts.bytes > maxBytes) {
    findings.push({
      level: "block",
      message: `That file is ${formatBytes(facts.bytes)}. The limit is ${formatBytes(
        maxBytes,
      )} — try a shorter clip.`,
    });
  }

  // A video whose length or size can't be read is usually a broken or
  // unsupported file; sending it only fails later, at review.
  if (facts.kind === "video" && spec.kind === "video") {
    if (!facts.durationSeconds || !facts.width || !facts.height) {
      findings.push({ level: "block", message: "We couldn't read this video. Try recording it again." });
    } else if (facts.bytes < MIN_VIDEO_BYTES) {
      findings.push({ level: "block", message: "That video is too small to be a real clip. Try recording it again." });
    }
  }

  if (facts.kind !== spec.kind) {
    findings.push({
      level: "block",
      message:
        spec.kind === "video"
          ? "This prompt needs a video, not a photo."
          : "This prompt needs a photo, not a video.",
    });
  }

  if (spec.orientation !== "any" && facts.width && facts.height) {
    const isPortrait = facts.height >= facts.width;
    if (spec.orientation === "portrait" && !isPortrait) {
      findings.push({
        level: "warn",
        message: "Filmed sideways. Vertical works far better — reshoot if you can.",
      });
    }
    if (spec.orientation === "landscape" && isPortrait) {
      findings.push({
        level: "warn",
        message: "This one wants landscape. Turn the phone sideways.",
      });
    }
  }

  const seconds = facts.durationSeconds;
  if (seconds !== undefined) {
    if (spec.min_seconds !== undefined && seconds < spec.min_seconds) {
      findings.push({
        level: "warn",
        message: `${round(seconds)}s is short — this prompt is aiming for ${
          spec.min_seconds
        }–${spec.max_seconds ?? "?"}s.`,
      });
    }
    if (spec.max_seconds !== undefined && seconds > spec.max_seconds) {
      findings.push({
        level: "warn",
        message: `${round(seconds)}s is long — marketing will cut it to about ${
          spec.max_seconds
        }s.`,
      });
    }
  }

  return findings;
}

export function blocks(findings: FormatFinding[]): boolean {
  return findings.some((f) => f.level === "block");
}

export function describeSpec(spec: FormatSpec): string {
  const parts: string[] = [spec.kind === "video" ? "Video" : "Photo"];
  if (spec.orientation !== "any") parts.push(spec.orientation);
  if (spec.kind === "video" && spec.min_seconds && spec.max_seconds) {
    parts.push(`${spec.min_seconds}–${spec.max_seconds}s`);
  }
  return parts.join(" · ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function round(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
