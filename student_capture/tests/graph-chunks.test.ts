import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHUNK_SIZE,
  GRAPH_CHUNK_MULTIPLE,
  GRAPH_MAX_CHUNK,
  chunksFrom,
  normalizeChunkSize,
  planChunks,
  resumeOffset,
} from "@/lib/graph/chunks";

describe("normalizeChunkSize", () => {
  it("keeps the default on the 320 KiB grid", () => {
    expect(DEFAULT_CHUNK_SIZE % GRAPH_CHUNK_MULTIPLE).toBe(0);
    expect(normalizeChunkSize() % GRAPH_CHUNK_MULTIPLE).toBe(0);
  });

  it("rounds an arbitrary request down onto the grid", () => {
    // 5 MiB is not a multiple of 320 KiB; Graph would fail on commit.
    expect(normalizeChunkSize(5 * 1024 * 1024) % GRAPH_CHUNK_MULTIPLE).toBe(0);
    expect(normalizeChunkSize(400_000)).toBe(GRAPH_CHUNK_MULTIPLE);
  });

  it("never returns zero for a tiny request", () => {
    expect(normalizeChunkSize(1)).toBe(GRAPH_CHUNK_MULTIPLE);
  });

  it("stays under the 60 MiB ceiling", () => {
    expect(normalizeChunkSize(500 * 1024 * 1024)).toBeLessThan(GRAPH_MAX_CHUNK);
    expect(normalizeChunkSize(500 * 1024 * 1024) % GRAPH_CHUNK_MULTIPLE).toBe(0);
  });
});

describe("planChunks", () => {
  it("covers the whole file with no gaps or overlaps", () => {
    const total = 150 * 1024 * 1024 + 12_345;
    const chunks = planChunks(total);

    expect(chunks[0]!.start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(total - 1);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end + 1);
    }
    expect(chunks.reduce((n, c) => n + c.size, 0)).toBe(total);
  });

  it("keeps every chunk but the last on the 320 KiB grid", () => {
    const chunks = planChunks(150 * 1024 * 1024 + 12_345);
    for (const c of chunks.slice(0, -1)) {
      expect(c.size % GRAPH_CHUNK_MULTIPLE).toBe(0);
    }
  });

  it("formats the two range headers the way each side wants them", () => {
    const [first] = planChunks(1000, GRAPH_CHUNK_MULTIPLE);
    // Graph's Content-Range is inclusive; an HTTP Range request is too, but the
    // syntax differs, and mixing them up silently truncates the upload.
    expect(first!.contentRange).toBe("bytes 0-999/1000");
    expect(first!.sourceRange).toBe("bytes=0-999");
  });

  it("handles a file smaller than one chunk", () => {
    const chunks = planChunks(500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ start: 0, end: 499, size: 500 });
  });

  it("handles a file that is exactly one chunk", () => {
    const chunks = planChunks(GRAPH_CHUNK_MULTIPLE, GRAPH_CHUNK_MULTIPLE);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.size).toBe(GRAPH_CHUNK_MULTIPLE);
  });

  it("refuses a nonsensical size rather than uploading nothing", () => {
    expect(() => planChunks(0)).toThrow(RangeError);
    expect(() => planChunks(-1)).toThrow(RangeError);
    expect(() => planChunks(1.5)).toThrow(RangeError);
  });
});

describe("resuming", () => {
  it("reads the offset out of an open-ended range", () => {
    expect(resumeOffset(["12345-"])).toBe(12_345);
  });

  it("reads the offset out of a bounded range", () => {
    expect(resumeOffset(["12345-55232", "77829-99375"])).toBe(12_345);
  });

  it("starts from zero when Graph says nothing useful", () => {
    expect(resumeOffset(undefined)).toBe(0);
    expect(resumeOffset([])).toBe(0);
    expect(resumeOffset(["nonsense"])).toBe(0);
  });

  it("drops only the chunks Graph already has", () => {
    const chunks = planChunks(GRAPH_CHUNK_MULTIPLE * 4, GRAPH_CHUNK_MULTIPLE);
    const remaining = chunksFrom(chunks, GRAPH_CHUNK_MULTIPLE * 2);
    expect(remaining).toHaveLength(2);
    expect(remaining[0]!.start).toBe(GRAPH_CHUNK_MULTIPLE * 2);
  });

  it("keeps a partially received chunk so its tail is re-sent", () => {
    const chunks = planChunks(GRAPH_CHUNK_MULTIPLE * 4, GRAPH_CHUNK_MULTIPLE);
    // Graph got half of chunk 2; that chunk must be re-sent whole.
    const remaining = chunksFrom(chunks, GRAPH_CHUNK_MULTIPLE + 100);
    expect(remaining[0]!.start).toBe(GRAPH_CHUNK_MULTIPLE);
  });
});
