import { redirect } from "next/navigation";
import { TodayView } from "@/components/views/TodayView";
import { createClient } from "@/lib/supabase/server";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import type { Idea } from "@/lib/types";
import { isoDate } from "@/lib/assign";
import { RELEASE_VERSION } from "@/app/consent/version";

export const dynamic = "force-dynamic";

export default async function Today() {
  const person = await requirePerson();
  // Staff have nothing to shoot; their work starts in the queue.
  if (person.role === "reviewer" || person.role === "admin") redirect("/review");

  if (person.role === "student" && !(await hasSignedRelease(person.id, RELEASE_VERSION))) {
    redirect("/consent");
  }

  const supabase = await createClient();
  const today = isoDate(new Date());

  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, due_on, completed_at, ideas!inner(id, title, brief, format_spec, reference_urls, guideline_set_ids, capture_mode, media_type, min_media_count, max_media_count, orientation, repeat_submission_policy, opens_at, closes_at, max_image_size, allowed_image_formats, min_image_width, min_image_height, min_duration_seconds, max_duration_seconds, caption_required, campaigns(name))",
    )
    .eq("person_id", person.id)
    .eq("due_on", today)
    .maybeSingle();

  const idea = (assignment?.ideas ?? null) as unknown as
    | (Idea & { campaigns?: { name: string } })
    | null;

  return (
    <TodayView
      person={person}
      assignment={assignment ? { id: assignment.id, completed_at: assignment.completed_at } : null}
      idea={idea}
    />
  );
}
