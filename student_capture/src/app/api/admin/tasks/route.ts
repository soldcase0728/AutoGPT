import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { expandTaskDates, taskCreateSchema } from "@/lib/admin-task";
import { fail, json, readJson } from "@/lib/http";

export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in to create content tasks.");
  if (person.role !== "admin") return fail(403, "Only a school administrator can create content tasks.");

  const parsed = taskCreateSchema.safeParse(await readJson<unknown>(request));
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Check the task details and try again.");
  }
  const input = parsed.data;
  const dates = expandTaskDates(input.startsOn, input.endsOn);
  if (!dates) return fail(400, "Choose a valid date range of 31 days or fewer.");

  const admin = createAdminClient();
  const [{ data: campaign }, { data: students }, { data: guidelineSets }] = await Promise.all([
    admin.from("campaigns").select("id").eq("id", input.campaignId).eq("org_id", person.org_id).eq("active", true).maybeSingle(),
    admin.from("people").select("id").eq("org_id", person.org_id).eq("role", "student").is("deactivated_at", null).in("id", input.studentIds),
    input.guidelineSetIds.length
      ? admin.from("guideline_sets").select("id").eq("org_id", person.org_id).in("id", input.guidelineSetIds)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
  ]);

  if (!campaign) return fail(400, "Choose an active campaign from your school.");
  if ((students ?? []).length !== new Set(input.studentIds).size) {
    return fail(400, "One or more selected students are not active on your school roster.");
  }
  if ((guidelineSets ?? []).length !== new Set(input.guidelineSetIds).size) {
    return fail(400, "One or more selected checklist sets are unavailable.");
  }

  const isVideo = input.mediaType === "video";
  const { data: idea, error: ideaError } = await admin
    .from("ideas")
    .insert({
      campaign_id: input.campaignId,
      title: input.title,
      brief: input.brief,
      capture_mode: "ASSIGNED",
      media_type: input.mediaType,
      orientation: input.orientation,
      min_media_count: input.minMediaCount,
      max_media_count: input.maxMediaCount,
      repeat_submission_policy: "ONCE",
      guideline_set_ids: input.guidelineSetIds,
      allowed_image_formats: isVideo ? null : ["image/jpeg", "image/png", "image/webp"],
      max_image_size: isVideo ? null : 25_000_000,
      min_duration_seconds: isVideo ? input.minDurationSeconds : null,
      max_duration_seconds: isVideo ? input.maxDurationSeconds : null,
      caption_required: input.captionRequired,
      format_spec: {
        kind: isVideo ? "video" : "photo",
        orientation: input.orientation,
        ...(isVideo ? {
          min_seconds: input.minDurationSeconds,
          max_seconds: input.maxDurationSeconds,
        } : {}),
      },
      active: true,
    })
    .select("id")
    .single();

  if (ideaError || !idea) return fail(500, ideaError?.message ?? "The prompt could not be created.");

  const requested = dates.flatMap((due_on) => input.studentIds.map((person_id) => ({
    idea_id: idea.id,
    person_id,
    due_on,
  })));
  const { data: existing, error: existingError } = await admin
    .from("assignments")
    .select("person_id, due_on")
    .in("person_id", input.studentIds)
    .gte("due_on", input.startsOn)
    .lte("due_on", input.endsOn);
  if (existingError) return fail(500, existingError.message);

  const occupied = new Set((existing ?? []).map((row) => `${row.person_id}:${row.due_on}`));
  const available = requested.filter((row) => !occupied.has(`${row.person_id}:${row.due_on}`));
  if (available.length) {
    const { error: assignmentError } = await admin.from("assignments").insert(available);
    if (assignmentError) return fail(500, assignmentError.message);
  }

  await admin.from("audit_log").insert({
    org_id: person.org_id,
    actor_id: person.id,
    action: "content_task.created",
    subject_type: "idea",
    subject_id: idea.id,
    detail: {
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      requested_assignments: requested.length,
      created_assignments: available.length,
      skipped_existing: requested.length - available.length,
    },
  });

  return json({
    id: idea.id,
    createdAssignments: available.length,
    skippedExisting: requested.length - available.length,
  }, 201);
}
