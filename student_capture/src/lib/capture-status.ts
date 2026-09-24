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
  peopleDecided: boolean;
}): string[] {
  const blockers: string[] = [];
  if (input.upload === "idle") blockers.push("Choose your shot and tap Use this.");
  if (input.upload === "uploading") blockers.push("Wait for the upload to finish.");
  if (input.upload === "failed") blockers.push("The upload didn't finish. Tap Try again above.");
  if (input.captionRequired && !input.oneLiner.trim()) blockers.push("Add a one-line caption.");
  if (!input.peopleDecided) {
    blockers.push("Tag who's in it, or tick “Nobody is recognisable”.");
  }
  return blockers;
}
