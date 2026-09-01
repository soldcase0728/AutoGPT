import { describe, expect, it } from "vitest";
import {
  promptAvailabilityError,
  reservationError,
  submissionError,
  type PromptSubmissionContract,
} from "@/lib/submission-contract";

const PHOTO: PromptSubmissionContract = {
  media_type: "PHOTO",
  min_media_count: 1,
  max_media_count: 3,
  required_orientation: "PORTRAIT",
  repeat_submission_policy: "MULTIPLE",
  opens_at: null,
  closes_at: null,
  max_image_size: 5_000_000,
  allowed_image_formats: ["image/jpeg", "image/webp"],
  min_image_width: 1080,
  min_image_height: 1350,
};

describe("promptAvailabilityError", () => {
  const now = new Date("2026-09-01T16:00:00Z");

  it("accepts an open prompt", () => {
    expect(
      promptAvailabilityError(
        { opens_at: "2026-09-01T15:00:00Z", closes_at: "2026-09-01T17:00:00Z" },
        now,
      ),
    ).toBeNull();
  });

  it("rejects prompts before and at/after their window boundaries", () => {
    expect(promptAvailabilityError({ opens_at: "2026-09-01T17:00:00Z", closes_at: null }, now))
      .toContain("not open");
    expect(promptAvailabilityError({ opens_at: null, closes_at: now.toISOString() }, now))
      .toContain("closed");
  });
});

describe("reservationError", () => {
  it("enforces media type, image format, and the stricter image byte limit", () => {
    expect(
      reservationError(PHOTO, { mediaType: "VIDEO", mimeType: "video/mp4", fileSize: 10 }, 20_000_000),
    ).toContain("photo");
    expect(
      reservationError(PHOTO, { mediaType: "PHOTO", mimeType: "image/heic", fileSize: 10 }, 20_000_000),
    ).toContain("format");
    expect(
      reservationError(
        PHOTO,
        { mediaType: "PHOTO", mimeType: "image/jpeg", fileSize: 5_000_001 },
        20_000_000,
      ),
    ).toContain("larger");
  });

  it("keeps the existing video upload contract", () => {
    const video = { ...PHOTO, media_type: "VIDEO" as const, max_image_size: null, allowed_image_formats: null };
    expect(
      reservationError(
        video,
        { mediaType: "VIDEO", mimeType: "video/quicktime", fileSize: 50_000_000 },
        100_000_000,
      ),
    ).toBeNull();
  });
});

describe("submissionError", () => {
  const valid = {
    mediaType: "PHOTO" as const,
    mimeType: "image/jpeg",
    fileSize: 2_000_000,
    width: 1080,
    height: 1920,
  };

  it("enforces relational media count", () => {
    expect(submissionError(PHOTO, [])).toContain("between 1 and 3");
    expect(submissionError(PHOTO, [valid, valid, valid, valid])).toContain("between 1 and 3");
  });

  it("enforces photo dimensions and orientation", () => {
    expect(submissionError(PHOTO, [{ ...valid, width: 1000 }])).toContain("wide");
    expect(submissionError(PHOTO, [{ ...valid, width: 1920, height: 1350 }])).toContain(
      "portrait",
    );
    expect(submissionError(PHOTO, [valid])).toBeNull();
  });
});
