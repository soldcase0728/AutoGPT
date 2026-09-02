import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { fail, json } from "@/lib/http";

/** Deletes masters whose rejected/withdrawn retention window has elapsed. */
export async function POST(request: Request) {
  const secret = request.headers.get("x-capture-cron-secret");
  if (!secret || secret !== serverEnv.cronSecret()) return fail(401, "Bad cron secret.");

  const admin = createAdminClient();
  const { data: captures, error } = await admin
    .from("captures")
    .select("id, org_id, bucket, submission_media(bucket, storage_key)")
    .in("state", ["rejected", "withdrawn"])
    .is("media_deleted_at", null)
    .lte("retention_due_at", new Date().toISOString())
    .limit(100);
  if (error) return fail(500, error.message);

  let deleted = 0;
  for (const capture of captures ?? []) {
    const byBucket = new Map<string, string[]>();
    for (const media of capture.submission_media ?? []) {
      const keys = byBucket.get(media.bucket) ?? [];
      keys.push(media.storage_key);
      byBucket.set(media.bucket, keys);
    }
    let deletionFailed = false;
    for (const [bucket, keys] of byBucket) {
      const { error: removeError } = await admin.storage.from(bucket).remove(keys);
      if (removeError) deletionFailed = true;
    }
    if (deletionFailed) continue;

    const deletedAt = new Date().toISOString();
    await admin.from("captures").update({ media_deleted_at: deletedAt }).eq("id", capture.id);
    await admin.from("audit_log").insert({
      org_id: capture.org_id,
      actor_id: null,
      action: "capture.media_deleted",
      subject_type: "capture",
      subject_id: capture.id,
      detail: { deleted_at: deletedAt, object_count: capture.submission_media?.length ?? 0 },
    });
    deleted += 1;
  }

  return json({ ok: true, deleted });
}
