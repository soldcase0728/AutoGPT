import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

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
  const oneLiner = body?.oneLiner?.trim();
  if (!oneLiner) return fail(400, "Tell us what is happening, in one line.");

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
    .select("id, person_id, assignment_id, bucket, storage_key, state")
    .eq("id", id)
    .maybeSingle();

  if (!capture) return fail(404, "That capture does not exist.");
  if (capture.person_id !== person.id) return fail(403, "That capture is not yours.");
  if (capture.state !== "uploading") {
    return fail(409, "That capture has already been submitted.");
  }

  // Never accept a submission for a file that did not actually land.
  const admin = createAdminClient();
  const slash = capture.storage_key.lastIndexOf("/");
  const dir = capture.storage_key.slice(0, slash);
  const filename = capture.storage_key.slice(slash + 1);
  const { data: listing, error: listError } = await admin.storage
    .from(capture.bucket)
    .list(dir, { search: filename, limit: 1 });

  if (listError) return fail(500, listError.message);
  if (!listing?.some((o) => o.name === filename)) {
    return fail(409, "The upload has not finished. Keep this screen open until it does.");
  }

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

  const { error: updateError } = await supabase
    .from("captures")
    .update({
      duration_s: body?.durationSeconds ?? null,
      width: body?.width ?? null,
      height: body?.height ?? null,
      captured_at: body?.capturedAt ?? new Date().toISOString(),
      checklist_ticked: body?.checklistTicked ?? [],
      guideline_version_ids: body?.guidelineVersionIds ?? [],
      no_people_in_frame: noPeopleInFrame,
      state: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .eq("id", capture.id);
  if (updateError) return fail(500, updateError.message);

  await admin
    .from("assignments")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", capture.assignment_id);

  await admin.from("audit_log").insert({
    org_id: person.org_id,
    actor_id: person.id,
    action: "capture.submitted",
    subject_type: "capture",
    subject_id: capture.id,
    detail: { people_tagged: peopleIds.length, no_people_in_frame: noPeopleInFrame },
  });

  return json({ ok: true, captureId: capture.id });
}
