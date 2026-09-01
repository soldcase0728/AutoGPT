import { describe, expect, it } from "vitest";
import {
  blocks,
  checkFormat,
  describeSpec,
  formatBytes,
} from "@/lib/format-spec";
import type { FormatSpec } from "@/lib/types";

const VERTICAL: FormatSpec = {
  kind: "video",
  orientation: "portrait",
  min_seconds: 10,
  max_seconds: 30,
};
const MAX = 512 * 1024 * 1024;

describe("checkFormat", () => {
  it("passes a clip that matches the brief", () => {
    const findings = checkFormat(
      VERTICAL,
      { kind: "video", durationSeconds: 18, width: 1080, height: 1920, bytes: 60_000_000 },
      MAX,
    );
    expect(findings).toEqual([]);
  });

  it("blocks the wrong medium", () => {
    const findings = checkFormat(
      VERTICAL,
      { kind: "photo", width: 3000, height: 4000, bytes: 4_000_000 },
      MAX,
    );
    expect(blocks(findings)).toBe(true);
    expect(findings[0]?.message).toMatch(/needs a video/);
  });

  it("blocks a file over the limit", () => {
    const findings = checkFormat(
      VERTICAL,
      { kind: "video", durationSeconds: 20, width: 1080, height: 1920, bytes: MAX + 1 },
      MAX,
    );
    expect(blocks(findings)).toBe(true);
  });

  it("only warns about a sideways clip — craft rules never stop a submission", () => {
    const findings = checkFormat(
      VERTICAL,
      { kind: "video", durationSeconds: 18, width: 1920, height: 1080, bytes: 50_000_000 },
      MAX,
    );
    expect(blocks(findings)).toBe(false);
    expect(findings.map((f) => f.level)).toEqual(["warn"]);
  });

  it("warns at both ends of the duration window", () => {
    const short = checkFormat(VERTICAL, { kind: "video", durationSeconds: 4, bytes: 1000 }, MAX);
    const long = checkFormat(VERTICAL, { kind: "video", durationSeconds: 90, bytes: 1000 }, MAX);
    expect(short[0]?.message).toMatch(/short/);
    expect(long[0]?.message).toMatch(/long/);
    expect(blocks([...short, ...long])).toBe(false);
  });

  it("skips orientation checks when the browser could not read the file", () => {
    const findings = checkFormat(VERTICAL, { kind: "video", bytes: 1000 }, MAX);
    expect(findings).toEqual([]);
  });

  it("treats a square clip as portrait rather than nagging", () => {
    const findings = checkFormat(
      { kind: "video", orientation: "portrait" },
      { kind: "video", width: 1080, height: 1080, bytes: 1000 },
      MAX,
    );
    expect(findings).toEqual([]);
  });
});

describe("describeSpec", () => {
  it("reads as a shot instruction", () => {
    expect(describeSpec(VERTICAL)).toBe("Video · portrait · 10–30s");
    expect(describeSpec({ kind: "photo", orientation: "any" })).toBe("Photo");
  });
});

describe("formatBytes", () => {
  it("stays readable across magnitudes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});
