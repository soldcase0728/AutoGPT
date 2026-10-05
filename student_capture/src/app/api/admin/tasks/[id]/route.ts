import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { schoolToday } from "@/lib/dates";
import { expandTaskDates, taskAssignSchema, taskTitle } from "@/lib/admin-task";
import { assignTask } from "@/lib/assign-task";
import { schoolDays } from "@/lib/task-progress";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    title: taskTitle,
    brief: z.string().trim().min(10).max(2000),
    captionRequired: z.boolean(),
    guidelineSetIds: z.array(z.string().uuid()).max(20),
  }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("delete") }),
  taskAssignSchema,
]);

/**
 * Edit, pause, resume, cancel or delete a content task. Assignments have no client
 * write path (see 0002_rls.sql), so like task creation this runs as the service
 * role after checking the caller is an admin of the task's school.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only a school administrator can change tasks.");

  const parsed = actionSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the task details and try again.");
  const body = parsed.data;

  const admin = createAdminClient();
  const { data: idea } = await admin
    .from("ideas")
    .select("id, active, cancelled_at, campaigns!inner(org_id)")
    .eq("id", id)
    .eq("campaigns.org_id", person.org_id)
    .maybeSingle();
  if (!idea) return fail(404, "That task isn't in your school.");
  if (body.action === "delete") {
    // Only a task nobody has sent anything for. Anything a student shot keeps
    // its task, so its history and the review trail stay whole (the database
    // enforces this too: captures.prompt_id is ON DELETE RESTRICT).
    const { count, error: countError } = await admin
      .from("captures").select("id", { count: "exact", head: true }).eq("prompt_id", id);
    if (countError) return fail(500, countError.message);
    if (count) {
      return fail(409, "Students have already sent something for this task, so it can't be deleted. Cancel it instead; what they sent stays.");
    }
    const { error } = await admin.from("ideas").delete().eq("id", id);
    if (error) return fail(500, error.message);
    await admin.from("audit_log").insert({
      org_id: person.org_id,
      actor_id: person.id,
      action: "content_task.deleted",
      subject_type: "idea",
      subject_id: id,
      detail: {},
    });
    return json({ ok: true, deleted: true });
  }
  if (idea.cancelled_at && body.action !== "edit") return fail(409, "That task was cancelled.");

  if (body.action === "assign") {
    const dates = schoolDays(expandTaskDates(body.startsOn, body.endsOn) ?? [], body.weekdaysOnly);
    if (!dates.length) return fail(400, "That range has no weekdays in it.");
    const assigned = await assignTask(admin, { orgId: person.org_id, ideaId: id, studentIds: body.studentIds, dates });
    if ("error" in assigned) return fail(assigned.status, assigned.error);
    await admin.from("audit_log").insert({
      org_id: person.org_id,
      actor_id: person.id,
      action: "content_task.assigned",
      subject_type: "idea",
      subject_id: id,
      detail: { starts_on: body.startsOn, ends_on: body.endsOn, created_assignments: assigned.created, skipped_existing: assigned.skipped.length },
    });
    return json({ ok: true, createdAssignments: assigned.created, skipped: assigned.skipped });
  }

  let detail: Record<string, unknown> = {};
  switch (body.action) {
    case "edit": {
      if (body.guidelineSetIds.length) {
        const { data: sets } = await admin
          .from("guideline_sets").select("id").eq("org_id", person.org_id).in("id", body.guidelineSetIds);
        if ((sets ?? []).length !== new Set(body.guidelineSetIds).size) {
          return fail(400, "One or more checklists are unavailable.");
        }
      }
      const { error } = await admin.from("ideas").update({
        title: body.title,
        brief: body.brief,
        caption_required: body.captionRequired,
        guideline_set_ids: body.guidelineSetIds,
      }).eq("id", id);
      if (error) return fail(500, error.message);
      detail = { title: body.title };
      break;
    }
    case "pause":
    case "resume": {
      const { error } = await admin.from("ideas").update({ active: body.action === "resume" }).eq("id", id);
      if (error) return fail(500, error.message);
      break;
    }
    case "cancel": {
      // Future and today's assignments that nobody has started are removed;
      // anything with a capture stays so its history is intact.
      const today = schoolToday();
      const { data: open } = await admin
        .from("assignments")
        .select("id, captures(id)")
        .eq("idea_id", id)
        .gte("due_on", today)
        .is("completed_at", null);
      const removable = (open ?? [])
        .filter((a) => !((a.captures as unknown as Array<unknown>) ?? []).length)
        .map((a) => a.id);
      if (removable.length) {
        const { error: deleteError } = await admin.from("assignments").delete().in("id", removable);
        if (deleteError) return fail(500, deleteError.message);
      }
      const { error } = await admin
        .from("ideas").update({ active: false, cancelled_at: new Date().toISOString() }).eq("id", id);
      if (error) return fail(500, error.message);
      detail = { removed_assignments: removable.length };
      break;
    }
  }

  await admin.from("audit_log").insert({
    org_id: person.org_id,
    actor_id: person.id,
    action: `content_task.${body.action === "edit" ? "edited" : body.action === "pause" ? "paused" : body.action === "resume" ? "resumed" : "cancelled"}`,
    subject_type: "idea",
    subject_id: id,
    detail,
  });
  return json({ ok: true, ...detail });
}
