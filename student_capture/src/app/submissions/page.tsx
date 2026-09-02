import { SubmissionsView, type SubmissionRow } from "@/components/views/SubmissionsView";
import { createClient } from "@/lib/supabase/server";
import { requirePerson } from "@/lib/session";
import type { CaptureState, PromptCaptureMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Submissions() {
  const person = await requirePerson();
  const supabase = await createClient();

  const [{ data: captures }, { data: assignments }] = await Promise.all([
    supabase
      .from("captures")
      .select(
        "id, assignment_id, state, created_at, submitted_at, state_changed_at, withdrawn_at, capture_context(one_liner), prompt:ideas!captures_prompt_id_fkey(title, capture_mode)",
      )
      .eq("person_id", person.id)
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("assignments")
      .select("id, due_on, completed_at, ideas!inner(title, closes_at)")
      .eq("person_id", person.id)
      .order("due_on", { ascending: false })
      .limit(120),
  ]);

  const captureRows = (captures ?? []) as unknown as Array<{
    id: string;
    assignment_id: string | null;
    state: CaptureState;
    created_at: string;
    submitted_at: string | null;
    state_changed_at: string;
    withdrawn_at: string | null;
    capture_context: { one_liner: string } | null;
    prompt: { title: string; capture_mode: PromptCaptureMode };
  }>;
  const captureIds = captureRows.map((row) => row.id);
  const [{ data: reviews }, { data: withdrawalDecisions }] = captureIds.length
    ? await Promise.all([
        supabase
          .from("reviews")
          .select("capture_id, note, created_at")
          .in("capture_id", captureIds)
          .not("note", "is", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("capture_withdrawal_requests")
          .select("capture_id, decision, decision_reason, decided_at")
          .in("capture_id", captureIds)
          .not("decision", "is", null)
          .order("decided_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const latestNote = new Map<string, string>();
  for (const review of reviews ?? []) {
    if (review.note && !latestNote.has(review.capture_id)) {
      latestNote.set(review.capture_id, review.note);
    }
  }
  const latestWithdrawalDecision = new Map<string, string>();
  for (const decision of withdrawalDecisions ?? []) {
    if (latestWithdrawalDecision.has(decision.capture_id)) continue;
    latestWithdrawalDecision.set(
      decision.capture_id,
      decision.decision === "denied"
        ? `Withdrawal kept in workflow: ${decision.decision_reason ?? "contact the marketing desk."}`
        : "Withdrawal approved.",
    );
  }

  const rows: SubmissionRow[] = captureRows.map((row) => ({
    id: `capture:${row.id}`,
    captureId: row.id,
    state: row.state,
    occurredAt: row.submitted_at ?? row.state_changed_at ?? row.created_at,
    ideaTitle: row.prompt?.title ?? "Prompt",
    oneLiner: row.capture_context?.one_liner ?? null,
    reviewNote: latestWithdrawalDecision.get(row.id) ?? latestNote.get(row.id) ?? null,
    source: row.prompt?.capture_mode === "OPEN_MOMENT" ? "Open Moment" : "Assigned",
    actionHref: null,
    withdrawMode:
      row.state === "uploading" || row.state === "submitted"
        ? "direct"
        : ["in_review", "approved", "changes_requested", "rejected", "published"].includes(row.state)
          ? "request"
          : null,
  }));

  const representedAssignments = new Set(
    captureRows.flatMap((row) => (row.assignment_id ? [row.assignment_id] : [])),
  );
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  for (const assignment of (assignments ?? []) as unknown as Array<{
    id: string;
    due_on: string;
    completed_at: string | null;
    ideas: { title: string; closes_at: string | null };
  }>) {
    if (representedAssignments.has(assignment.id) || assignment.completed_at) continue;
    const expired = assignment.due_on < today || Boolean(
      assignment.ideas.closes_at && new Date(assignment.ideas.closes_at) <= now,
    );
    rows.push({
      id: `assignment:${assignment.id}`,
      captureId: null,
      state: expired ? "expired" : "assigned",
      occurredAt: `${assignment.due_on}T12:00:00`,
      ideaTitle: assignment.ideas.title,
      oneLiner: null,
      reviewNote: null,
      source: "Assigned",
      actionHref: expired ? null : `/capture/${assignment.id}`,
      withdrawMode: null,
    });
  }

  rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return <SubmissionsView person={person} rows={rows} />;
}
