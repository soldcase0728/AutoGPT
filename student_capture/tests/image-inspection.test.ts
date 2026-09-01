import { describe, expect, it } from "vitest";
import { inspectImage } from "@/lib/image-inspection";

describe("inspectImage", () => {
  it("reads PNG dimensions from its signature and IHDR", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set([0, 0, 4, 0], 16);
    bytes.set([0, 0, 3, 0], 20);
    expect(inspectImage(bytes)).toEqual({
      mimeType: "image/png",
      width: 1024,
      height: 768,
      hasExif: false,
    });
  });

  it("reads JPEG dimensions and detects an EXIF segment", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x07, 0x80, 0x04, 0x38, 0x03, 0x01, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    expect(inspectImage(bytes)).toEqual({
      mimeType: "image/jpeg",
      width: 1080,
      height: 1920,
      hasExif: true,
    });
  });

  it("rejects extension-only and malformed input", () => {
    expect(inspectImage(new TextEncoder().encode("not really a photo.jpg"))).toBeNull();
  });
});
