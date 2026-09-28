import type {
  PromptMediaType,
  PromptOrientation,
  PromptRepeatPolicy,
} from "./types";

export interface PromptSubmissionContract {
  media_type: PromptMediaType;
  min_media_count: number;
  max_media_count: number;
  orientation: PromptOrientation;
  repeat_submission_policy: PromptRepeatPolicy;
  opens_at: string | null;
  closes_at: string | null;
  max_image_size: number | null;
  allowed_image_formats: string[] | null;
  min_image_width: number | null;
  min_image_height: number | null;
  min_duration_seconds?: number | null;
  max_duration_seconds?: number | null;
  caption_required?: boolean;
}

export interface SubmissionMediaFacts {
  mediaType: "video" | "photo";
  mimeType: string | null;
  fileSize: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

export function promptAvailabilityError(
  prompt: Pick<PromptSubmissionContract, "opens_at" | "closes_at">,
  now = new Date(),
): string | null {
  const time = now.getTime();
  if (prompt.opens_at && time < new Date(prompt.opens_at).getTime()) {
    return "This prompt is not open yet.";
  }
  if (prompt.closes_at && time >= new Date(prompt.closes_at).getTime()) {
    return "This prompt has closed.";
  }
  return null;
}

export function reservationError(
  prompt: PromptSubmissionContract,
  media: SubmissionMediaFacts,
  platformMaxBytes: number,
): string | null {
  const expectedObjectType = prompt.media_type === "video" ? "video" : "photo";
  if (media.mediaType !== expectedObjectType) {
    return expectedObjectType === "photo"
      ? "This prompt needs a photo, not a video."
      : "This prompt needs a video, not a photo.";
  }
  if (!media.fileSize || media.fileSize <= 0) return "A positive byte count is required.";
  const limit =
    prompt.media_type !== "video" && prompt.max_image_size
      ? Math.min(platformMaxBytes, prompt.max_image_size)
      : platformMaxBytes;
  if (media.fileSize > limit) return `That file is larger than the ${limit} byte limit.`;

  if (prompt.media_type !== "video") {
    const mime = media.mimeType?.toLowerCase() ?? "";
    const formats = (prompt.allowed_image_formats ?? []).map((value) => value.toLowerCase());
    if (!mime || !formats.includes(mime)) {
      return "That image format is not allowed for this prompt.";
    }
  }
  return null;
}

export function submissionError(
  prompt: PromptSubmissionContract,
  media: SubmissionMediaFacts[],
): string | null {
  if (media.length < prompt.min_media_count || media.length > prompt.max_media_count) {
    return `This prompt needs between ${prompt.min_media_count} and ${prompt.max_media_count} media item${
      prompt.max_media_count === 1 ? "" : "s"
    }.`;
  }

  for (const item of media) {
    const expectedObjectType = prompt.media_type === "video" ? "video" : "photo";
    if (item.mediaType !== expectedObjectType) return "A media item has the wrong type.";
    if (prompt.media_type === "video") {
      if (
        prompt.min_duration_seconds &&
        (!item.durationSeconds || item.durationSeconds < prompt.min_duration_seconds)
      ) return `Video must be at least ${prompt.min_duration_seconds} seconds.`;
      if (
        prompt.max_duration_seconds &&
        (!item.durationSeconds || item.durationSeconds > prompt.max_duration_seconds)
      ) return `Video must be no longer than ${prompt.max_duration_seconds} seconds.`;
      const orientationError = mediaOrientationError(prompt.orientation, item.width, item.height);
      if (orientationError) return orientationError;
      continue;
    }
    if (prompt.min_image_width && (!item.width || item.width < prompt.min_image_width)) {
      return `Each image must be at least ${prompt.min_image_width}px wide.`;
    }
    if (prompt.min_image_height && (!item.height || item.height < prompt.min_image_height)) {
      return `Each image must be at least ${prompt.min_image_height}px tall.`;
    }
    const orientationError = mediaOrientationError(prompt.orientation, item.width, item.height);
    if (orientationError) return orientationError;
  }
  return null;
}

export function toPromptMediaType(kind: "photo" | "video"): "photo" | "video" {
  return kind;
}

export function detectedOrientation(
  width?: number | null,
  height?: number | null,
): PromptOrientation | null {
  if (!width || !height) return null;
  const ratio = width / height;
  if (ratio >= 0.95 && ratio <= 1.05) return "square";
  return width > height ? "landscape" : "portrait";
}

function mediaOrientationError(
  required: PromptOrientation,
  width?: number | null,
  height?: number | null,
): string | null {
  if (required === "any") return null;
  const actual = detectedOrientation(width, height);
  if (!actual) return "Media dimensions are required to verify orientation.";
  return actual === required ? null : `Media must use ${required} orientation.`;
}

export interface ReshootTake {
  createdAt: string;
  checksum: string | null;
}

/**
 * A reshoot can only be sent with a new take: every file in the current media
 * revision must have arrived after the desk sent the shot back, and none may be
 * a byte-for-byte copy of a file the desk already saw. Null when it may be sent.
 */
export function reshootGateError(input: {
  mediaRevision: number;
  sentBackAt: string | null;
  take: ReshootTake[];
  earlierChecksums: string[];
}): string | null {
  if (input.mediaRevision < 2) return null;
  const message = "Upload a new take first.";
  if (!input.take.length) return message;
  if (input.sentBackAt) {
    const cutoff = new Date(input.sentBackAt).getTime();
    if (input.take.some((item) => new Date(item.createdAt).getTime() <= cutoff)) return message;
  }
  const earlier = new Set(input.earlierChecksums);
  if (input.take.some((item) => item.checksum && earlier.has(item.checksum))) return message;
  return null;
}
