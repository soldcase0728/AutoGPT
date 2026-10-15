/**
 * Words for the capture screen: why an upload stopped, and what is still
 * missing before "Send it" works. Pure, so both are unit-tested.
 */

import { formatBytes } from "./format-spec";

export type UploadFailureKind = "offline" | "too_large" | "signed_out" | "other";

export interface UploadFailure {
  kind: UploadFailureKind;
  message: string;
}

/** An error thrown while starting or running an upload, with an HTTP status when one is known. */
export class UploadStepError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UploadStepError";
  }
}

/** tus-js-client's DetailedError carries the response it failed on. */
function statusOf(error: unknown): number | undefined {
  if (error instanceof UploadStepError) return error.status;
  const response = (error as { originalResponse?: { getStatus?: () => number } } | null)
    ?.originalResponse;
  const status = response?.getStatus?.();
  return typeof status === "number" && status > 0 ? status : undefined;
}

export function describeUploadFailure(
  error: unknown,
  context: { online: boolean; fileBytes?: number; maxBytes?: number },
): UploadFailure {
  const status = statusOf(error);
  const text = error instanceof Error ? error.message : "";

  if (status === 401 || status === 403 && /sign in|session|jwt|token/i.test(text) || /sign in first|session expired|jwt/i.test(text)) {
    return {
      kind: "signed_out",
      message:
        "You were signed out. Sign in again in a new tab, then come back and tap Try again. Your shot is still here.",
    };
  }

  if (status === 413 || /larger than|too large|payload too large|maximum allowed size/i.test(text)) {
    const size = context.fileBytes ? ` (${formatBytes(context.fileBytes)})` : "";
    const limit = context.maxBytes ? ` The limit is ${formatBytes(context.maxBytes)}.` : "";
    return {
      kind: "too_large",
      message: `This file is too big to send${size}.${limit} Retake it shorter, or trim it in your camera app.`,
    };
  }

  if (
    !context.online ||
    status === undefined && /network|failed to fetch|load failed|connection|timeout|offline|xhr/i.test(text)
  ) {
    return {
      kind: "offline",
      message:
        "The connection dropped. Keep this screen open and tap Try again when you have signal. It picks up where it stopped.",
    };
  }

  return {
    kind: "other",
    message: text ? `The upload stopped: ${text}` : "The upload stopped. Tap Try again.",
  };
}

export type UploadState = "idle" | "uploading" | "done" | "failed";

/** Why "Send it" is not available yet, in the order the student meets them. */
export function sendBlockers(input: {
  upload: UploadState;
  captionRequired: boolean;
  oneLiner: string;
}): string[] {
  const blockers: string[] = [];
  if (input.upload === "idle") blockers.push("Choose your shot and tap Upload this.");
  if (input.upload === "uploading") blockers.push("Wait for the upload to finish.");
  if (input.upload === "failed") blockers.push("The upload didn't finish. Tap Try again above.");
  if (input.captionRequired && !input.oneLiner.trim()) blockers.push("Add a one-line caption.");
  return blockers;
}

/** Everything still in the way of Send, as one line: "To send: … …". */
export function sendHint(blockers: string[]): string | null {
  return blockers.length ? `To send: ${blockers.join(" ")}` : null;
}

/** Where the student is getting the shot from. */
export type ShotSource = "camera" | "roll";

/**
 * The safety confirmation, worded for what the student is actually doing:
 * a promise before shooting, a statement about a clip or photo that already exists.
 */
export function safetyAckText(source: ShotSource, kind: "video" | "photo"): string {
  if (source === "camera") return "I’ll shoot this safely.";
  return kind === "video" ? "This was filmed safely." : "This was taken safely.";
}

/** The button that opens the chosen source. */
export function sourceButtonText(source: ShotSource, kind: "video" | "photo"): string {
  if (source === "camera") return kind === "video" ? "Record now" : "Take a photo now";
  return "Choose from camera roll";
}

/**
 * Where the shot is, in the student's terms. Each stage says only what is
 * true at that moment: nothing reads as sent until the marketing desk's side
 * has confirmed it.
 */
export type ShotStage = "on_phone" | "uploading" | "uploaded" | "sending" | "received" | "failed";

export function shotStageText(stage: ShotStage, progress = 0): string {
  switch (stage) {
    case "on_phone":
      return "On your phone only. Nothing has been sent yet.";
    case "uploading":
      return `Uploading ${Math.round(progress * 100)}%. Keep this screen open. Not sent to marketing yet.`;
    case "uploaded":
      return "Uploaded, but not sent yet. Tap Send it to give it to the marketing desk.";
    case "sending":
      return "Sending to the marketing desk…";
    case "received":
      return "Received by the marketing desk.";
    case "failed":
      return "The upload didn’t finish. Nothing has been sent.";
  }
}
