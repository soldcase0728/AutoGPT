import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isoDate } from "@/lib/assign";
import { assignmentStatuses, taskProgress, type TaskCapture } from "@/lib/task-progress";
import type { CaptureState } from "@/lib/types";
import { TaskDetail, type TaskStudentRow } from "./TaskDetail";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, brief, media_type, orientation, min_media_count, max_media_count, min_duration_seconds, max_duration_seconds, caption_required, guideline_set_ids, active, cancelled_at, campaigns!inner(name, org_id)")
    .eq("id", id)
    .eq("campaigns.org_id", me.org_id)
    .maybeSingle();
  if (!idea) notFound();

  const [{ data: assignments }, { data: captures }, { data: guidelineSets }] = await Promise.all([
    supabase.from("assignments").select("id, person_id, due_on").eq("idea_id", id).order("due_on"),
    supabase
      .from("captures")
      .select("assignment_id, state, submitted_at, state_changed_at")
      .eq("prompt_id", id),
    supabase.from("guideline_sets").select("id, name, kind").eq("org_id", me.org_id).order("kind"),
  ]);

  const personIds = [...new Set((assignments ?? []).map((a) => a.person_id))];
  const { data: people } = personIds.length
    ? await supabase.from("people").select("id, display_name, email").in("id", personIds)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  const today = isoDate(new Date());
  const list = (assignments ?? []).map((a) => ({ id: a.id, personId: a.person_id, dueOn: a.due_on }));
  const statuses = assignmentStatuses(
    list,
    ((captures ?? []) as Array<{ assignment_id: string | null; state: CaptureState; submitted_at: string | null; state_changed_at: string }>).map(
      (c): TaskCapture => ({ assignmentId: c.assignment_id, state: c.state, submittedAt: c.submitted_at, stateChangedAt: c.state_changed_at }),
    ),
    today,
  );
  const progress = taskProgress(list, statuses);

  const rows: TaskStudentRow[] = list.map((a) => ({
    assignmentId: a.id,
    personId: a.personId,
    name: byId.get(a.personId)?.display_name ?? "Former student",
    email: byId.get(a.personId)?.email ?? "",
    dueOn: a.dueOn,
    status: statuses.get(a.id) ?? "not_sent",
  }));

  const campaign = idea.campaigns as unknown as { name: string };

  return (
    <>
      <AppHeader person={me} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <TaskDetail
          task={{
            id: idea.id,
            title: idea.title,
            brief: idea.brief,
            campaign: campaign.name,
            mediaType: idea.media_type,
            orientation: idea.orientation,
            minDurationSeconds: idea.min_duration_seconds,
            maxDurationSeconds: idea.max_duration_seconds,
            captionRequired: idea.caption_required,
            guidelineSetIds: idea.guideline_set_ids ?? [],
            active: idea.active,
            cancelled: Boolean(idea.cancelled_at),
          }}
          progress={progress}
          rows={rows}
          guidelineSets={guidelineSets ?? []}
        />
      </main>
    </>
  );
}
