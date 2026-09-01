import type {
  PromptMediaType,
  PromptOrientation,
  PromptRepeatPolicy,
} from "./types";

export interface PromptSubmissionContract {
  media_type: PromptMediaType;
  min_media_count: number;
  max_media_count: number;
  required_orientation: PromptOrientation;
  repeat_submission_policy: PromptRepeatPolicy;
  opens_at: string | null;
  closes_at: string | null;
  max_image_size: number | null;
  allowed_image_formats: string[] | null;
  min_image_width: number | null;
  min_image_height: number | null;
}

export interface SubmissionMediaFacts {
  mediaType: PromptMediaType;
  mimeType: string | null;
  fileSize: number | null;
  width?: number | null;
  height?: number | null;
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
  if (media.mediaType !== prompt.media_type) {
    return prompt.media_type === "PHOTO"
      ? "This prompt needs a photo, not a video."
      : "This prompt needs a video, not a photo.";
  }
  if (!media.fileSize || media.fileSize <= 0) return "A positive byte count is required.";
  const limit =
    prompt.media_type === "PHOTO" && prompt.max_image_size
      ? Math.min(platformMaxBytes, prompt.max_image_size)
      : platformMaxBytes;
  if (media.fileSize > limit) return `That file is larger than the ${limit} byte limit.`;

  if (prompt.media_type === "PHOTO") {
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
    if (item.mediaType !== prompt.media_type) return "A media item has the wrong type.";
    if (prompt.media_type !== "PHOTO") continue;
    if (prompt.min_image_width && (!item.width || item.width < prompt.min_image_width)) {
      return `Each image must be at least ${prompt.min_image_width}px wide.`;
    }
    if (prompt.min_image_height && (!item.height || item.height < prompt.min_image_height)) {
      return `Each image must be at least ${prompt.min_image_height}px tall.`;
    }
    if (item.width && item.height && prompt.required_orientation !== "ANY") {
      const orientation = item.height >= item.width ? "PORTRAIT" : "LANDSCAPE";
      if (orientation !== prompt.required_orientation) {
        return `Each image must use ${prompt.required_orientation.toLowerCase()} orientation.`;
      }
    }
  }
  return null;
}

export function toPromptMediaType(kind: "photo" | "video"): PromptMediaType {
  return kind === "photo" ? "PHOTO" : "VIDEO";
}
