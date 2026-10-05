import { describe, expect, it } from "vitest";
import { inspectImage, stripJpegMetadata } from "@/lib/image-inspection";

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

describe("stripJpegMetadata", () => {
  // SOI, JFIF APP0, Safari-style EXIF APP1, an XMP APP1, a comment, ICC APP2,
  // SOF0 (1080×1920), then start of scan with "image data" and EOI.
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xe1, 0x00, 0x06, 0x68, 0x74, 0x74, 0x70,
    0xff, 0xfe, 0x00, 0x04, 0x68, 0x69,
    0xff, 0xe2, 0x00, 0x04, 0x49, 0x43,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x07, 0x80, 0x04, 0x38, 0x03, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0x00, 0x56,
    0xff, 0xd9,
  ]);

  it("takes out EXIF, XMP and comments so the submit check passes", () => {
    expect(inspectImage(jpeg)?.hasExif).toBe(true);
    const clean = stripJpegMetadata(jpeg);
    expect(inspectImage(clean)).toEqual({ mimeType: "image/jpeg", width: 1080, height: 1920, hasExif: false });
    const text = String.fromCharCode(...clean);
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("http");
  });

  it("keeps JFIF, the colour profile and every byte of image data", () => {
    const clean = stripJpegMetadata(jpeg);
    expect(Array.from(clean.slice(2, 11))).toEqual([0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    expect(Array.from(clean.slice(-11))).toEqual([0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
    expect(String.fromCharCode(...clean)).toContain("IC");
  });

  it("leaves anything that isn't a well-formed JPEG alone", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(stripJpegMetadata(png)).toBe(png);
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x45]);
    expect(stripJpegMetadata(truncated)).toBe(truncated);
  });
});
