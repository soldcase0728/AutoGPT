import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

/**
 * Throws away the new take of a reshoot so the student can shoot it again.
 * Only for a reshoot (media revision 2+) that hasn't been sent: the capture
 * itself, its earlier takes and its review history all stay.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const supabase = await createClient();
  const { data: capture } = await supabase
    .from("captures")
    .select("id, person_id, state, media_revision")
    .eq("id", id)
    .maybeSingle();
  if (!capture || capture.person_id !== person.id) return fail(404, "That shot isn't yours.");
  if (capture.state !== "uploading" || capture.media_revision < 2) {
    return fail(409, "Only an unsent reshoot can be retaken this way.");
  }

  const { data: rows, error } = await supabase
    .from("submission_media")
    .select("id, bucket, storage_key")
    .eq("submission_id", capture.id)
    .eq("media_revision", capture.media_revision);
  if (error) return fail(500, error.message);
  if (!rows?.length) return json({ ok: true, removed: 0 });

  // Rows through the student's own session, so RLS decides; files through the
  // service role, since students can't delete from storage directly.
  const { error: deleteError } = await supabase
    .from("submission_media")
    .delete()
    .in("id", rows.map((row) => row.id));
  if (deleteError) return fail(500, deleteError.message);

  const admin = createAdminClient();
  const byBucket = new Map<string, string[]>();
  for (const row of rows) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.storage_key]);
  await Promise.all([...byBucket].map(([bucket, keys]) => admin.storage.from(bucket).remove(keys)));

  return json({ ok: true, removed: rows.length });
}
