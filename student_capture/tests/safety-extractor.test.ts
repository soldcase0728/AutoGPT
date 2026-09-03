import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import ffmpegPath from "ffmpeg-static";
import { extractVideo } from "@/lib/safety/extractor";

const execute = promisify(execFile);

describe("video safety extraction", () => {
  it("samples authoritative one-second frames, extracts audio, and removes temporary files", async () => {
    if (!ffmpegPath) throw new Error("ffmpeg test binary is unavailable");
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "safety-fixture-"));
    const fixture = join(fixtureDirectory, "short.mp4");
    try {
      await execute(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
        "-i", "color=c=blue:s=320x240:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-shortest", "-pix_fmt", "yuv420p", "-y", fixture]);
      const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("student-safety-")));
      const result = await extractVideo(new Uint8Array(await readFile(fixture)));
      const after = (await readdir(tmpdir())).filter((name) => name.startsWith("student-safety-") && !before.has(name));
      expect(result.durationMs).toBeGreaterThanOrEqual(1900);
      expect(result.frames.map((frame) => frame.timestampMs)).toEqual([0, 1000]);
      expect(result.frames.every((frame) => frame.bytes.length > 0)).toBe(true);
      expect(result.audio?.length).toBeGreaterThan(0);
      expect(after).toEqual([]);
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});
