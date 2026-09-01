import { describe, expect, it } from "vitest";
import {
  captureObjectName,
  ownerOf,
  safeFilename,
  submissionMediaObjectName,
} from "@/lib/storage-key";

describe("safeFilename", () => {
  it("keeps a normal phone filename recognisable", () => {
    expect(safeFilename("IMG_4821.MOV")).toBe("IMG_4821.mov");
  });

  it("flattens spaces and unicode", () => {
    expect(safeFilename("game day — pré game.mp4")).toBe("game-day-pre-game.mp4");
  });

  it("strips any path a client tries to smuggle in", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("a\\b\\c.mp4")).toBe("c.mp4");
  });

  it("always yields something usable", () => {
    expect(safeFilename("")).toBe("capture");
    expect(safeFilename("???")).toBe("capture");
    expect(safeFilename(".mp4")).toBe(".mp4");
  });

  it("caps a runaway name", () => {
    expect(safeFilename("x".repeat(500) + ".mp4").length).toBeLessThanOrEqual(64);
  });
});

describe("submissionMediaObjectName", () => {
  it("keeps the owner first and gives every media row its own prefix", () => {
    const key = submissionMediaObjectName(
      "person-1",
      "submission-9",
      "media-2",
      "Second Photo.JPG",
    );
    expect(key).toBe("person-1/submission-9/media-2/Second-Photo.jpg");
    expect(ownerOf(key)).toBe("person-1");
  });
});

describe("captureObjectName", () => {
  const key = captureObjectName("person-1", "capture-9", "My Clip.mp4");

  it("puts the owner first, which is what the storage policy checks", () => {
    expect(key).toBe("person-1/capture-9/My-Clip.mp4");
    expect(ownerOf(key)).toBe("person-1");
  });

  it("cannot be escaped by a crafted filename", () => {
    const hostile = captureObjectName("person-1", "capture-9", "../../other/evil.mp4");
    expect(ownerOf(hostile)).toBe("person-1");
    expect(hostile.split("/")).toHaveLength(3);
  });
});
