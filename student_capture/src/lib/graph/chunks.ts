/**
 * Chunk planning for Microsoft Graph upload sessions.
 *
 * Graph is strict here and the failures are late and confusing — a bad chunk
 * size uploads happily and then fails when the last range commits. The rules,
 * from the createUploadSession reference:
 *
 *   - every chunk except the last MUST be a multiple of 320 KiB (327,680 bytes)
 *   - no chunk may reach 60 MiB
 *   - 5–10 MiB is the recommended size
 *   - chunks go up sequentially, and Content-Range must cover the whole file
 *
 * Kept pure so all of that is testable without a tenant.
 */

export const GRAPH_CHUNK_MULTIPLE = 327_680; // 320 KiB
export const GRAPH_MAX_CHUNK = 60 * 1024 * 1024; // exclusive
export const DEFAULT_CHUNK_SIZE = 8 * GRAPH_CHUNK_MULTIPLE; // 2.5 MiB × ... = 2,621,440

export interface Chunk {
  /** Inclusive first byte. */
  start: number;
  /** Inclusive last byte — Graph's Content-Range is inclusive at both ends. */
  end: number;
  size: number;
  /** Ready to use as the `Content-Range` header value. */
  contentRange: string;
  /** Ready to use as a `Range` header when pulling the same span from source. */
  sourceRange: string;
}

export function normalizeChunkSize(requested = DEFAULT_CHUNK_SIZE): number {
  const rounded =
    Math.max(1, Math.floor(requested / GRAPH_CHUNK_MULTIPLE)) * GRAPH_CHUNK_MULTIPLE;
  // Stay strictly under the 60 MiB ceiling.
  const capped = Math.min(rounded, GRAPH_MAX_CHUNK - GRAPH_CHUNK_MULTIPLE);
  return capped;
}

export function planChunks(totalBytes: number, requestedSize?: number): Chunk[] {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new RangeError(`totalBytes must be a positive integer, got ${totalBytes}`);
  }

  const size = normalizeChunkSize(requestedSize);
  const chunks: Chunk[] = [];

  for (let start = 0; start < totalBytes; start += size) {
    const end = Math.min(start + size, totalBytes) - 1;
    chunks.push({
      start,
      end,
      size: end - start + 1,
      contentRange: `bytes ${start}-${end}/${totalBytes}`,
      sourceRange: `bytes=${start}-${end}`,
    });
  }

  return chunks;
}

/**
 * Graph reports what it still wants as `nextExpectedRanges: ["12345-"]` or
 * `["12345-55232", ...]`. Returns the first byte it is waiting for so a resumed
 * upload restarts in the right place.
 */
export function resumeOffset(nextExpectedRanges: string[] | undefined): number {
  const first = nextExpectedRanges?.[0];
  if (!first) return 0;
  const start = Number.parseInt(first.split("-")[0] ?? "", 10);
  return Number.isFinite(start) && start >= 0 ? start : 0;
}

/** Drops chunks Graph already has, so a resume does not re-send them. */
export function chunksFrom(chunks: Chunk[], offset: number): Chunk[] {
  if (offset <= 0) return chunks;
  return chunks.filter((c) => c.end >= offset);
}
