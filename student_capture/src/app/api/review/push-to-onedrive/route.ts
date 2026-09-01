import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { graphConfig } from "@/lib/graph/client";
import { uploadFile } from "@/lib/graph/upload";
import { safeFilename } from "@/lib/storage-key";

interface Body {
  captureIds?: string[];
  state?: string;
  limit?: number;
}

const EXPORTABLE = ["approved", "published"];
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * Pushes approved masters into the marketing team's SharePoint/OneDrive folder,
 * which is where they already work. Each file is streamed a chunk at a time
 * from Supabase Storage straight into a Graph upload session, so a 200 MB clip
 * never sits in this process's memory.
 */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can export captures.");
  }

  const config = graphConfig();
  if (!config) {
    return fail(
      501,
      "OneDrive export is not configured. Set MS_TENANT_ID, MS_CLIENT_ID, " +
        "MS_CLIENT_SECRET and MS_DRIVE_ID — see the README.",
    );
  }

  const body = (await readJson<Body>(request)) ?? {};
  const state = body.state ?? "approved";
  if (!EXPORTABLE.includes(state)) {
    return fail(400, `state must be one of: ${EXPORTABLE.join(", ")}.`);
  }
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);

  const supabase = await createClient();
  let query = supabase
    .from("review_queue")
    .select("id, student, idea_title, storage_key, bucket, master_bytes, submitted_at")
    .order("submitted_at", { ascending: true })
    .limit(limit);

  query = body.captureIds?.length
    ? query.in("id", body.captureIds)
    : query.eq("state", state);

  const { data: rows, error } = await query;
  if (error) return fail(500, error.message);
  if (!rows?.length) return json({ exported: 0, results: [] });

  const admin = createAdminClient();
  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    try {
      const { data: signed, error: signError } = await admin.storage
        .from(row.bucket)
        .createSignedUrl(row.storage_key, SIGNED_URL_SECONDS);
      if (signError || !signed) throw new Error(signError?.message ?? "Could not sign the master.");

      const bytes = row.master_bytes ?? (await headSize(signed.signedUrl));
      if (!bytes) throw new Error("Could not determine the file size.");

      // Named so a human scanning the SharePoint folder knows what they have.
      const day = (row.submitted_at ?? new Date().toISOString()).slice(0, 10);
      const extension = row.storage_key.split(".").pop() ?? "bin";
      const filename = safeFilename(
        `${day}-${row.student}-${row.idea_title}.${extension}`,
      );

      const item = await uploadFile({
        config,
        folder: `${config.folder}/${day}`,
        filename,
        totalBytes: bytes,
        readRange: (range) => fetchRange(signed.signedUrl, range),
      });

      await admin.from("audit_log").insert({
        org_id: person.org_id,
        actor_id: person.id,
        action: "capture.exported_to_onedrive",
        subject_type: "capture",
        subject_id: row.id,
        detail: { drive_item_id: item.id, name: item.name, web_url: item.webUrl ?? null },
      });

      results.push({ captureId: row.id, ok: true, name: item.name, webUrl: item.webUrl });
    } catch (cause) {
      // One bad file must not strand the rest of the batch.
      results.push({
        captureId: row.id,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return json({
    exported: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

async function fetchRange(url: string, range: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { range }, cache: "no-store" });
  // 206 is the expected answer; 200 means the store ignored the Range header,
  // which would silently send the whole file as one "chunk".
  if (response.status !== 206) {
    throw new Error(`Source did not honour ${range} (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
}

async function headSize(url: string): Promise<number | null> {
  const response = await fetch(url, { method: "HEAD", cache: "no-store" });
  const length = response.headers.get("content-length");
  return length ? Number.parseInt(length, 10) : null;
}
