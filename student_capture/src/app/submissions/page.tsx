import { SubmissionsView, type SubmissionRow } from "@/components/views/SubmissionsView";
import { createClient } from "@/lib/supabase/server";
import { requirePerson } from "@/lib/session";
import type { CaptureState } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Submissions() {
  const person = await requirePerson();
  const supabase = await createClient();

  const { data: captures } = await supabase
    .from("captures")
    .select(
      "id, state, created_at, submitted_at, capture_context(one_liner), assignments!inner(ideas!inner(title))",
    )
    .eq("person_id", person.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows: SubmissionRow[] = (
    (captures ?? []) as unknown as Array<{
      id: string;
      state: CaptureState;
      created_at: string;
      submitted_at: string | null;
      capture_context: { one_liner: string } | null;
      assignments: { ideas: { title: string } };
    }>
  ).map((row) => ({
    id: row.id,
    state: row.state,
    created_at: row.created_at,
    submitted_at: row.submitted_at,
    ideaTitle: row.assignments?.ideas?.title ?? "",
    oneLiner: row.capture_context?.one_liner ?? null,
  }));

  return <SubmissionsView person={person} rows={rows} />;
}
