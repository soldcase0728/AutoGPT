import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { SafetyProviderError } from "./schemas";

const MAX_VIDEO_BYTES = 262_144_000;
const MAX_DURATION_SECONDS = 120;
const MAX_FRAMES = 120;

function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(-8_000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`Media process exited ${code}: ${stderr.slice(-500)}`)));
  });
}

function probeDuration(binary: string, source: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-i", source], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return reject(new Error("Video duration could not be read."));
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
}

export interface ExtractedFrame { timestampMs: number; bytes: Uint8Array }
export interface ExtractedVideo { durationMs: number; frames: ExtractedFrame[]; audio: Uint8Array | null }

export async function extractVideo(bytes: Uint8Array): Promise<ExtractedVideo> {
  if (!ffmpegPath) {
    throw new SafetyProviderError("extractor_not_configured", "Video extractor is unavailable.", false);
  }
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new SafetyProviderError("video_too_large", "Video exceeds the safety processor limit.", false);
  }
  const directory = await mkdtemp(join(tmpdir(), "student-safety-"));
  const source = join(directory, "source.mp4");
  const audioPath = join(directory, "audio.mp3");
  try {
    await writeFile(source, bytes);
    const durationSeconds = await probeDuration(ffmpegPath, source);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new SafetyProviderError("invalid_video", "Video duration could not be read.", false);
    }
    if (durationSeconds > MAX_DURATION_SECONDS + 0.5) {
      throw new SafetyProviderError("video_too_long", "Video exceeds the safety processor duration limit.", false);
    }
    const framePattern = join(directory, "frame-%06d.jpg");
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", source,
      "-vf", "fps=1,scale='min(1600,iw)':-2", "-frames:v", String(MAX_FRAMES), "-q:v", "3", framePattern]);
    const frameNames = (await readdir(directory)).filter((name) => name.startsWith("frame-")).sort();
    const frames = await Promise.all(frameNames.map(async (name, index) => ({
      timestampMs: index * 1000,
      bytes: new Uint8Array(await readFile(join(directory, name))),
    })));
    let audio: Uint8Array | null = null;
    try {
      await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", source, "-vn",
        "-ac", "1", "-ar", "16000", "-b:a", "48k", "-y", audioPath]);
      audio = new Uint8Array(await readFile(audioPath));
    } catch {
      // Silent videos remain valid and still receive visual analysis.
    }
    return { durationMs: Math.round(durationSeconds * 1000), frames, audio };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
