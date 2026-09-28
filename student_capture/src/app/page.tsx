import { redirect } from "next/navigation";
import { TodayView, type TodaySentBack } from "@/components/views/TodayView";
import { createClient } from "@/lib/supabase/server";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import type { Idea } from "@/lib/types";
import { schoolToday } from "@/lib/dates";
import { loadStudentProgress } from "@/lib/student-progress";
import { RELEASE_VERSION } from "@/app/consent/version";

export const dynamic = "force-dynamic";

export default async function Today() {
  const person = await requirePerson();
  // Staff have nothing to shoot: admins start on the overview, reviewers in the queue.
  if (person.role === "admin") redirect("/admin");
  if (person.role === "reviewer") redirect("/review");

  if (person.role === "student" && !(await hasSignedRelease(person.id, RELEASE_VERSION))) {
    redirect("/consent");
  }

  const supabase = await createClient();
  const today = schoolToday();

  const progressPromise = person.role === "student" ? loadStudentProgress(supabase, person.id) : Promise.resolve(null);
  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, due_on, completed_at, ideas!inner(id, title, brief, format_spec, reference_urls, guideline_set_ids, capture_mode, media_type, min_media_count, max_media_count, orientation, repeat_submission_policy, opens_at, closes_at, max_image_size, allowed_image_formats, min_image_width, min_image_height, min_duration_seconds, max_duration_seconds, caption_required, campaigns(name))",
    )
    .eq("person_id", person.id)
    .eq("due_on", today)
    // A paused or cancelled task is not today's prompt.
    .eq("ideas.active", true)
    .maybeSingle();

  // The newest shot the desk sent back, returned or mid-reshoot. It leads Today.
  let sentBack: TodaySentBack | null = null;
  if (person.role === "student") {
    const { data: returned } = await supabase
      .from("captures")
      .select("id, assignment_id, state, media_revision, prompt:ideas!captures_prompt_id_fkey(title)")
      .eq("person_id", person.id)
      .or("state.eq.changes_requested,and(state.eq.uploading,media_revision.gt.1)")
      .order("state_changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (returned?.assignment_id) {
      const { data: review } = await supabase
        .from("reviews")
        .select("note")
        .eq("capture_id", returned.id)
        .eq("state", "changes_requested")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sentBack = {
        assignmentId: returned.assignment_id,
        title: (returned.prompt as unknown as { title: string } | null)?.title ?? "Your shot",
        note: (review as { note: string | null } | null)?.note ?? null,
      };
    }
  }

  const idea = (assignment?.ideas ?? null) as unknown as
    | (Idea & { campaigns?: { name: string } })
    | null;

  return (
    <TodayView
      person={person}
      assignment={assignment ? { id: assignment.id, completed_at: assignment.completed_at } : null}
      idea={idea}
      progress={await progressPromise}
      sentBack={sentBack}
    />
  );
}
