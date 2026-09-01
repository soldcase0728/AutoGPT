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
  filename: string;
  mime: string;
  bytes: number;
  kind: "video" | "photo";
  /** Present when reserving another object for an uploading submission. */
  captureId?: string;
}

/**
 * Reserves a capture row and an object key. The file itself never touches this
 * server — the phone uploads straight to storage over a resumable session, and
 * calls /submit when it lands.
 */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const body = await readJson<Body>(request);
  if (!body?.assignmentId || !body.filename) {
    return fail(400, "assignmentId and filename are required.");
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
      "id, idea_id, person_id, completed_at, ideas!inner(media_type, min_media_count, max_media_count, required_orientation, repeat_submission_policy, opens_at, closes_at, max_image_size, allowed_image_formats, min_image_width, min_image_height)",
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
      mime_type: body.mime || null,
      file_size: body.bytes,
    });
    if (mediaInsertError) return fail(500, mediaInsertError.message);
    return json({ captureId: capture.id, mediaId, bucket, objectName, sortOrder });
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
    bucket,
    storage_key: objectName,
    kind: body.kind === "photo" ? "photo" : "video",
    mime: body.mime || null,
    master_bytes: body.bytes,
    state: "uploading",
  });

  if (error) return fail(500, error.message);

  const { data: primaryMedia, error: mediaErrorAfterInsert } = await supabase
    .from("submission_media")
    .select("id, sort_order")
    .eq("submission_id", captureId)
    .eq("sort_order", 0)
    .single();
  if (mediaErrorAfterInsert) return fail(500, mediaErrorAfterInsert.message);

  return json({
    captureId,
    mediaId: primaryMedia.id,
    bucket,
    objectName,
    sortOrder: primaryMedia.sort_order,
  });
}
