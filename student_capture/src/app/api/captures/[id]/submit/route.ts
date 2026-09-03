import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import {
  detectedOrientation,
  promptAvailabilityError,
  reservationError,
  submissionError,
  type PromptSubmissionContract,
  type SubmissionMediaFacts,
} from "@/lib/submission-contract";
import { inspectImage } from "@/lib/image-inspection";
import { publicEnv } from "@/lib/env";

interface MediaBody {
  id: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  fileSize?: number;
}

interface Body {
  oneLiner: string;
  locationLabel?: string;
  peopleIds?: string[];
  noPeopleInFrame?: boolean;
  durationSeconds?: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  checklistTicked?: string[];
  guidelineVersionIds?: string[];
  /** Normalized multi-media clients send one metadata entry per reserved row. */
  media?: MediaBody[];
}

/** Finalises an upload: records context, tags who is in frame, hands it to review. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const body = await readJson<Body>(request);
  const oneLiner = body?.oneLiner?.trim() ?? "";

  const peopleIds = [...new Set(body?.peopleIds ?? [])];
  const noPeopleInFrame = Boolean(body?.noPeopleInFrame);
  if (peopleIds.length === 0 && !noPeopleInFrame) {
    return fail(400, "Tag everyone in frame, or confirm nobody is identifiable.");
  }
  if (peopleIds.length > 0 && noPeopleInFrame) {
    return fail(400, "Either nobody is in frame, or someone is. Not both.");
  }

  const supabase = await createClient();

  const { data: capture } = await supabase
    .from("captures")
    .select("id, person_id, assignment_id, prompt_id, bucket, storage_key, state, media_revision")
    .eq("id", id)
    .maybeSingle();

  if (!capture) return fail(404, "That capture does not exist.");
  if (capture.person_id !== person.id) return fail(403, "That capture is not yours.");
  if (capture.state !== "uploading") {
    if (["submitted", "in_review", "approved", "changes_requested", "rejected", "published"].includes(capture.state)) {
      return json({ ok: true, captureId: capture.id, alreadySubmitted: true });
    }
    return fail(409, "That capture can no longer be submitted.");
  }
  if (person.participation !== "active") {
    return fail(
      403,
      person.participation === "revoked"
        ? "Your account became read-only before this upload finished. The file was not submitted."
        : "Your account must be approved before this upload can be submitted.",
    );
  }

  const { data: prompt, error: promptError } = await supabase
    .from("ideas")
    .select(
      "media_type, min_media_count, max_media_count, orientation, repeat_submission_policy, opens_at, closes_at, max_image_size, allowed_image_formats, min_image_width, min_image_height, min_duration_seconds, max_duration_seconds, caption_required",
    )
    .eq("id", capture.prompt_id)
    .maybeSingle();
  if (promptError) return fail(500, promptError.message);
  if (!prompt) return fail(409, "The prompt for this submission no longer exists.");

  const promptContract = prompt as unknown as PromptSubmissionContract;
  if (promptContract.caption_required && !oneLiner) {
    return fail(400, "Tell us what is happening, in one line.");
  }
  const availabilityError = promptAvailabilityError(promptContract);
  if (availabilityError) return fail(409, availabilityError);

  const { data: mediaRows, error: mediaReadError } = await supabase
    .from("submission_media")
    .select(
      "id, submission_id, media_type, bucket, storage_key, sort_order, width, height, duration, mime_type, file_size",
    )
    .eq("submission_id", capture.id)
    .eq("media_revision", capture.media_revision)
    .order("sort_order");
  if (mediaReadError) return fail(500, mediaReadError.message);
  if (!mediaRows?.length) return fail(409, "This submission has no media.");

  const metadataById = new Map((body?.media ?? []).map((item) => [item.id, item]));
  if (body?.media && metadataById.size !== body.media.length) {
    return fail(400, "Each media item may appear only once.");
  }
  if (body?.media?.some((item) => !mediaRows.some((row) => row.id === item.id))) {
    return fail(400, "A media item does not belong to this submission.");
  }

  const normalizedMedia = mediaRows.map((row, index) => {
    const supplied = metadataById.get(row.id);
    return {
      row,
      durationSeconds:
        supplied?.durationSeconds ?? (index === 0 ? body?.durationSeconds : undefined) ?? row.duration,
      width: supplied?.width ?? (index === 0 ? body?.width : undefined) ?? row.width,
      height: supplied?.height ?? (index === 0 ? body?.height : undefined) ?? row.height,
      mimeType: supplied?.mimeType ?? row.mime_type,
      fileSize: supplied?.fileSize ?? row.file_size,
    };
  });

  // Never accept a submission if any reserved object did not actually land.
  const admin = createAdminClient();
  for (const item of normalizedMedia) {
    if (item.row.media_type === "photo") {
      const { data: object, error: downloadError } = await admin.storage
        .from(item.row.bucket)
        .download(item.row.storage_key);
      if (downloadError || !object) {
        return fail(409, "An upload has not finished. Keep this screen open until it does.");
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      const image = inspectImage(bytes);
      if (!image) return fail(400, "An uploaded image has an invalid or unsupported signature.");
      if (image.hasExif) return fail(400, "An uploaded image still contains EXIF or location metadata.");
      item.width = image.width;
      item.height = image.height;
      item.mimeType = image.mimeType;
      item.fileSize = bytes.byteLength;
      const imageError = reservationError(
        promptContract,
        { mediaType: "photo", mimeType: image.mimeType, fileSize: bytes.byteLength },
        publicEnv.maxUploadBytes(),
      );
      if (imageError) return fail(imageError.includes("larger") ? 413 : 400, imageError);
      continue;
    }
    const slash = item.row.storage_key.lastIndexOf("/");
    const dir = item.row.storage_key.slice(0, slash);
    const filename = item.row.storage_key.slice(slash + 1);
    const { data: listing, error: listError } = await admin.storage
      .from(item.row.bucket)
      .list(dir, { search: filename, limit: 1 });
    if (listError) return fail(500, listError.message);
    if (!listing?.some((object) => object.name === filename)) {
      return fail(409, "An upload has not finished. Keep this screen open until it does.");
    }
  }

  const contractError = submissionError(
    promptContract,
    normalizedMedia.map(
      (item): SubmissionMediaFacts => ({
        mediaType: item.row.media_type,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        width: item.width,
        height: item.height,
        durationSeconds: item.durationSeconds,
      }),
    ),
  );
  if (contractError) return fail(400, contractError);

  // Context and tags must be written while the capture is still `uploading` —
  // their RLS policies close as soon as it moves to the review queue.
  const { error: contextError } = await supabase
    .from("capture_context")
    .upsert(
      {
        capture_id: capture.id,
        one_liner: oneLiner,
        location_label: body?.locationLabel?.trim() || null,
      },
      { onConflict: "capture_id" },
    );
  if (contextError) return fail(500, contextError.message);

  if (peopleIds.length > 0) {
    const { error: peopleError } = await supabase
      .from("capture_people")
      .upsert(
        peopleIds.map((pid) => ({ capture_id: capture.id, person_id: pid })),
        { onConflict: "capture_id,person_id" },
      );
    if (peopleError) return fail(500, peopleError.message);
  }

  for (const item of normalizedMedia) {
    const { error: mediaUpdateError } = await supabase
      .from("submission_media")
      .update({
        duration: item.durationSeconds ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        mime_type: item.mimeType ?? null,
        file_size: item.fileSize ?? null,
      })
      .eq("id", item.row.id);
    if (mediaUpdateError) return fail(500, mediaUpdateError.message);
  }

  const primary = normalizedMedia[0];
  if (!primary) return fail(409, "This submission has no primary media.");

  const { error: updateError } = await supabase
    .from("captures")
    .update({
      duration_s: primary.durationSeconds ?? null,
      width: primary.width ?? null,
      height: primary.height ?? null,
      orientation: detectedOrientation(primary.width, primary.height),
      mime: primary.mimeType ?? null,
      master_bytes: primary.fileSize ?? null,
      bucket: primary.row.bucket,
      storage_key: primary.row.storage_key,
      kind: primary.row.media_type === "photo" ? "photo" : "video",
      exif_stripped: promptContract.media_type === "video" ? false : true,
      captured_at: body?.capturedAt ?? new Date().toISOString(),
      checklist_ticked: body?.checklistTicked ?? [],
      guideline_version_ids: body?.guidelineVersionIds ?? [],
      no_people_in_frame: noPeopleInFrame,
      state: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .eq("id", capture.id);
  if (updateError) return fail(500, updateError.message);

  if (capture.assignment_id) {
    await admin
      .from("assignments")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", capture.assignment_id);
  }

  await admin.from("audit_log").insert({
    org_id: person.org_id,
    actor_id: person.id,
    action: "capture.submitted",
    subject_type: "capture",
    subject_id: capture.id,
    detail: {
      people_tagged: peopleIds.length,
      no_people_in_frame: noPeopleInFrame,
      media_count: normalizedMedia.length,
    },
  });

  return json({ ok: true, captureId: capture.id });
}
