import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail } from "@/lib/http";

const SIGNED_URL_SECONDS = 60 * 30;

/**
 * Redirects to a short-lived signed URL for the capture. Visibility is decided
 * by RLS on the read below; the signed URL is only minted once that read has
 * already succeeded for this caller.
 *
 * Phase 1 always serves the master. When the ingest worker starts writing
 * `proxy_key`, this is the one place that has to change.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const supabase = await createClient();
  const { data: capture } = await supabase
    .from("captures")
    .select("id, person_id, state, bucket, storage_key, proxy_key, mime, media_revision")
    .eq("id", id)
    .maybeSingle();

  if (!capture) return fail(404, "That capture does not exist.");
  if (
    capture.person_id !== person.id &&
    (capture.state === "withdrawal_requested" || capture.state === "withdrawn")
  ) {
    return fail(404, "That capture is no longer available to the marketing desk.");
  }

  const searchParams = new URL(request.url).searchParams;
  const wantsDownload = searchParams.get("disposition") === "attachment";
  const mediaId = searchParams.get("mediaId");

  let bucket = capture.bucket;
  let storageKey = capture.storage_key;
  if (mediaId) {
    const { data: media } = await supabase
      .from("submission_media")
      .select("id, submission_id, bucket, storage_key")
      .eq("id", mediaId)
      .eq("submission_id", capture.id)
      .eq("media_revision", capture.media_revision)
      .maybeSingle();
    if (!media) return fail(404, "That media item does not exist.");
    bucket = media.bucket;
    storageKey = media.storage_key;
  } else {
    const { data: primary } = await supabase
      .from("submission_media")
      .select("bucket, storage_key")
      .eq("submission_id", capture.id)
      .eq("media_revision", capture.media_revision)
      .eq("sort_order", 0)
      .maybeSingle();
    if (primary) {
      bucket = primary.bucket;
      storageKey = primary.storage_key;
    }
  }

  // Reviewing plays the proxy when one exists; downloading always takes the master.
  const key = mediaId
    ? storageKey
    : wantsDownload
      ? storageKey
      : capture.proxy_key ?? capture.storage_key;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(key, SIGNED_URL_SECONDS,
      wantsDownload ? { download: key.split("/").pop() ?? "capture" } : undefined);

  if (error || !data) return fail(500, error?.message ?? "Could not sign that file.");

  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
