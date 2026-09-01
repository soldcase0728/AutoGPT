import "server-only";

import { GRAPH, accessToken, encodeDrivePath, type GraphConfig } from "./client";
import { chunksFrom, planChunks, resumeOffset, type Chunk } from "./chunks";

/**
 * Uploads one file to a Graph drive through an upload session.
 *
 * The bytes are pulled a chunk at a time from `readRange`, so a 200 MB master
 * moves from Supabase Storage to SharePoint without ever being held whole in
 * memory here.
 */

export interface UploadResult {
  id: string;
  name: string;
  size: number;
  webUrl?: string;
}

interface UploadArgs {
  config: GraphConfig;
  /** Path under the drive root, e.g. "Student captures/2026-09-01". */
  folder: string;
  filename: string;
  totalBytes: number;
  /** Fetches an inclusive byte range of the source file. */
  readRange: (range: string) => Promise<ArrayBuffer>;
  chunkSize?: number;
}

const MAX_ATTEMPTS = 4;

export async function uploadFile({
  config,
  folder,
  filename,
  totalBytes,
  readRange,
  chunkSize,
}: UploadArgs): Promise<UploadResult> {
  const token = await accessToken(config);
  const path = encodeDrivePath(`${folder}/${filename}`);

  const created = await fetch(
    `${GRAPH}/drives/${config.driveId}/root:/${path}:/createUploadSession`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      // `rename` rather than `replace`: an export must never quietly overwrite
      // something already in the marketing folder.
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "rename", name: filename },
      }),
      cache: "no-store",
    },
  );

  if (!created.ok) {
    const detail = await created.text();
    throw new Error(
      `createUploadSession failed (${created.status}) for ${filename}: ${detail.slice(0, 300)}`,
    );
  }

  const { uploadUrl } = (await created.json()) as { uploadUrl: string };
  let remaining = planChunks(totalBytes, chunkSize);

  for (let i = 0; i < remaining.length; i += 1) {
    const chunk = remaining[i]!;
    const result = await putChunk(uploadUrl, chunk, readRange);

    if (result.done) return result.item;

    if (result.resumeFrom !== undefined) {
      // Graph and we disagree about progress; believe Graph.
      remaining = chunksFrom(planChunks(totalBytes, chunkSize), result.resumeFrom);
      i = -1;
    }
  }

  throw new Error(`Upload of ${filename} ended without Graph committing the file.`);
}

type ChunkOutcome =
  | { done: true; item: UploadResult }
  | { done: false; resumeFrom?: number };

async function putChunk(
  uploadUrl: string,
  chunk: Chunk,
  readRange: (range: string) => Promise<ArrayBuffer>,
): Promise<ChunkOutcome> {
  const body = await readRange(chunk.sourceRange);
  if (body.byteLength !== chunk.size) {
    throw new Error(
      `Source returned ${body.byteLength} bytes for ${chunk.sourceRange}, expected ${chunk.size}.`,
    );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // No Authorization header here on purpose: the upload URL is already
    // pre-authenticated, and sending a bearer token makes Graph answer 401.
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(chunk.size),
        "content-range": chunk.contentRange,
      },
      body,
      cache: "no-store",
    });

    if (response.status === 200 || response.status === 201) {
      return { done: true, item: (await response.json()) as UploadResult };
    }

    if (response.status === 202) {
      const body = (await response.json().catch(() => ({}))) as {
        nextExpectedRanges?: string[];
      };
      const expected = resumeOffset(body.nextExpectedRanges);
      // Only rewind when Graph wants something other than the next chunk.
      return expected && expected !== chunk.end + 1
        ? { done: false, resumeFrom: expected }
        : { done: false };
    }

    if (response.status === 404) {
      throw new Error("Upload session expired. Re-run the export for this capture.");
    }

    if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(2 ** attempt * 500);
      continue;
    }

    const detail = await response.text();
    throw new Error(
      `Chunk ${chunk.contentRange} rejected (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  throw new Error(`Chunk ${chunk.contentRange} failed after ${MAX_ATTEMPTS} attempts.`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
