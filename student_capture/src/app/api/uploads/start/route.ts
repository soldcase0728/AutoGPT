import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { captureObjectName, submissionMediaObjectName } from "@/lib/storage-key";
import { publicEnv } from "@/lib/env";
import { fail, json, readJson } from "@/lib/http";
import {
  promptAvailabilityError,
  reservationError,
  toPromptMediaType,
  type PromptSubmissionContract,
} from "@/lib/submission-contract";

interface Body {
  assignmentId: string;
  clientSubmissionId?: string;
  clientMediaId: string;
  filename: string;
  mime: string;
  bytes: number;
  kind: "video" | "photo";
  /** Present when reserving another object for an uploading submission. */
  captureId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reserves a capture row and an object key. The file itself never touches this
 * server — the phone uploads straight to storage over a resumable session, and
 * calls /submit when it lands.
 */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const body = await readJson<Body>(request);
  if (!body?.assignmentId || !body.filename || !UUID.test(body.clientMediaId ?? "")) {
    return fail(400, "assignmentId, filename, and clientMediaId are required.");
  }
  if (!body.captureId && !UUID.test(body.clientSubmissionId ?? "")) {
    return fail(400, "clientSubmissionId is required for a new submission.");
  }
  if (body.kind !== "photo" && body.kind !== "video") {
    return fail(400, "kind must be photo or video.");
  }

  // Rule 7: a roster row is not an approval. The database refuses the insert
  // either way; saying so here turns a bare 500 into an explanation.
  if (person.participation !== "active") {
    return fail(
      403,
      person.participation === "revoked"
        ? "Your account is read-only. Talk to the marketing desk."
        : "Your account has not been approved yet. The marketing desk has to approve it before you can send anything.",
    );
  }

  const supabase = await createClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select(
      "id, idea_id, person_id, completed_at, ideas!inner(media_type, min_media_count, max_media_count, orientation, repeat_submission_policy, opens_at, closes_at, max_image_size, allowed_image_formats, min_image_width, min_image_height, min_duration_seconds, max_duration_seconds, caption_required)",
    )
    .eq("id", body.assignmentId)
    .maybeSingle();

  if (assignmentError) return fail(500, assignmentError.message);
  if (!assignment) return fail(404, "That prompt is not assigned to you.");
  if (assignment.person_id !== person.id) {
    return fail(403, "That prompt belongs to someone else.");
  }
  const prompt = assignment.ideas as unknown as PromptSubmissionContract;
  if (assignment.completed_at && prompt.repeat_submission_policy === "ONCE") {
    return fail(409, "You have already submitted for this prompt.");
  }

  const availabilityError = promptAvailabilityError(prompt);
  if (availabilityError) return fail(409, availabilityError);

  const mediaType = toPromptMediaType(body.kind);
  const mediaError = reservationError(
    prompt,
    { mediaType, mimeType: body.mime || null, fileSize: body.bytes },
    publicEnv.maxUploadBytes(),
  );
  if (mediaError) return fail(mediaError.includes("larger") ? 413 : 400, mediaError);

  const bucket = publicEnv.captureBucket();

  if (body.captureId) {
    const { data: capture } = await supabase
      .from("captures")
      .select("id, assignment_id, person_id, state")
      .eq("id", body.captureId)
      .maybeSingle();
    if (!capture) return fail(404, "That submission does not exist.");
    if (capture.person_id !== person.id || capture.assignment_id !== assignment.id) {
      return fail(403, "That submission is not yours.");
    }
    if (capture.state !== "uploading") {
      return fail(409, "That submission has already been submitted.");
    }

    const { data: retriedMedia } = await supabase
      .from("submission_media")
      .select("id, bucket, storage_key, sort_order")
      .eq("submission_id", capture.id)
      .eq("client_media_id", body.clientMediaId)
      .maybeSingle();
    if (retriedMedia) {
      return json({
        captureId: capture.id,
        mediaId: retriedMedia.id,
        bucket: retriedMedia.bucket,
        objectName: retriedMedia.storage_key,
        sortOrder: retriedMedia.sort_order,
      });
    }

    const { data: existing, error: mediaReadError } = await supabase
      .from("submission_media")
      .select("id, sort_order")
      .eq("submission_id", capture.id)
      .order("sort_order");
    if (mediaReadError) return fail(500, mediaReadError.message);
    if ((existing?.length ?? 0) >= prompt.max_media_count) {
      return fail(409, "This submission already has the maximum number of media items.");
    }

    const mediaId = crypto.randomUUID();
    const sortOrder = existing?.length ?? 0;
    const objectName = submissionMediaObjectName(
      person.id,
      capture.id,
      mediaId,
      body.filename,
    );
    const { error: mediaInsertError } = await supabase.from("submission_media").insert({
      id: mediaId,
      submission_id: capture.id,
      media_type: mediaType,
      bucket,
      storage_key: objectName,
      sort_order: sortOrder,
      client_media_id: body.clientMediaId,
      mime_type: body.mime || null,
      file_size: body.bytes,
    });
    if (mediaInsertError) {
      if (mediaInsertError.code === "23505") {
        const { data: concurrentRetry } = await supabase
          .from("submission_media")
          .select("id, bucket, storage_key, sort_order")
          .eq("submission_id", capture.id)
          .eq("client_media_id", body.clientMediaId)
          .maybeSingle();
        if (concurrentRetry) {
          return json({
            captureId: capture.id,
            mediaId: concurrentRetry.id,
            bucket: concurrentRetry.bucket,
            objectName: concurrentRetry.storage_key,
            sortOrder: concurrentRetry.sort_order,
          });
        }
      }
      return fail(500, mediaInsertError.message);
    }
    return json({ captureId: capture.id, mediaId, bucket, objectName, sortOrder });
  }

  const { data: retriedCapture } = await supabase
    .from("captures")
    .select("id, assignment_id, state, bucket")
    .eq("person_id", person.id)
    .eq("client_submission_id", body.clientSubmissionId!)
    .maybeSingle();
  if (retriedCapture) {
    if (retriedCapture.assignment_id !== assignment.id) {
      return fail(409, "That retry key belongs to a different prompt.");
    }
    if (retriedCapture.state !== "uploading") {
      return fail(409, "That submission has already been submitted.");
    }
    const { data: primaryMedia, error: primaryError } = await supabase
      .from("submission_media")
      .select("id, bucket, storage_key, sort_order, client_media_id")
      .eq("submission_id", retriedCapture.id)
      .eq("sort_order", 0)
      .single();
    if (primaryError) return fail(500, primaryError.message);
    if (!primaryMedia.client_media_id) {
      const { error: claimError } = await supabase
        .from("submission_media")
        .update({ client_media_id: body.clientMediaId })
        .eq("id", primaryMedia.id);
      if (claimError) return fail(500, claimError.message);
    } else if (primaryMedia.client_media_id !== body.clientMediaId) {
      return fail(409, "That submission already has a different first media item.");
    }
    return json({
      captureId: retriedCapture.id,
      mediaId: primaryMedia.id,
      bucket: primaryMedia.bucket,
      objectName: primaryMedia.storage_key,
      sortOrder: primaryMedia.sort_order,
    });
  }

  const captureId = crypto.randomUUID();
  const objectName = captureObjectName(person.id, captureId, body.filename);

  // Inserted through the caller's own session, so the RLS insert policy is the
  // thing that decides whether this is allowed.
  const { error } = await supabase.from("captures").insert({
    id: captureId,
    assignment_id: assignment.id,
    person_id: person.id,
    org_id: person.org_id,
    prompt_id: assignment.idea_id,
    media_type: prompt.media_type,
    bucket,
    storage_key: objectName,
    kind: body.kind === "photo" ? "photo" : "video",
    mime: body.mime || null,
    master_bytes: body.bytes,
    client_submission_id: body.clientSubmissionId,
    state: "uploading",
  });

  if (error) {
    if (error.code === "23505") {
      const { data: concurrentCapture } = await supabase
        .from("captures")
        .select("id, state")
        .eq("person_id", person.id)
        .eq("client_submission_id", body.clientSubmissionId!)
        .maybeSingle();
      if (concurrentCapture?.state === "uploading") {
        const { data: concurrentMedia } = await supabase
          .from("submission_media")
          .select("id, bucket, storage_key, sort_order")
          .eq("submission_id", concurrentCapture.id)
          .eq("sort_order", 0)
          .single();
        if (concurrentMedia) {
          await supabase
            .from("submission_media")
            .update({ client_media_id: body.clientMediaId })
            .eq("id", concurrentMedia.id)
            .is("client_media_id", null);
          return json({
            captureId: concurrentCapture.id,
            mediaId: concurrentMedia.id,
            bucket: concurrentMedia.bucket,
            objectName: concurrentMedia.storage_key,
            sortOrder: concurrentMedia.sort_order,
          });
        }
      }
    }
    return fail(500, error.message);
  }

  const { data: primaryMedia, error: mediaErrorAfterInsert } = await supabase
    .from("submission_media")
    .select("id, sort_order")
    .eq("submission_id", captureId)
    .eq("sort_order", 0)
    .single();
  if (mediaErrorAfterInsert) return fail(500, mediaErrorAfterInsert.message);

  const { error: mediaClaimError } = await supabase
    .from("submission_media")
    .update({ client_media_id: body.clientMediaId })
    .eq("id", primaryMedia.id);
  if (mediaClaimError) return fail(500, mediaClaimError.message);

  return json({
    captureId,
    mediaId: primaryMedia.id,
    bucket,
    objectName,
    sortOrder: primaryMedia.sort_order,
  });
}
