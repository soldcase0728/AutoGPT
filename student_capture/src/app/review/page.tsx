import { AppHeader } from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import type { CaptureSafetyReview, QueueRow, SafetyFinding } from "@/lib/types";
import { ReviewQueue, type WithdrawalRow } from "./ReviewQueue";

export const dynamic = "force-dynamic";

const OPEN_STATES = ["submitted", "in_review", "changes_requested", "approved"];

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const person = await requireStaff();
  const { state } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("review_queue")
    .select("*")
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(200);

  query = state ? query.eq("state", state) : query.in("state", OPEN_STATES);

  const [{ data, error }, { data: withdrawalRequests }] = await Promise.all([
    query,
    supabase
      .from("capture_withdrawal_requests")
      .select("id, capture_id, reason, requested_at")
      .is("decision", null)
      .order("requested_at", { ascending: true })
      .limit(100),
  ]);

  const captureIds = (data ?? []).map((row) => row.id);
  const { data: safetySummaries } = captureIds.length
    ? await supabase.from("review_safety_summary").select("*").in("capture_id", captureIds)
    : { data: [] };
  const screenIds = (safetySummaries ?? []).map((row) => row.safety_screen_id);
  const { data: safetyFindings } = screenIds.length
    ? await supabase.from("safety_findings")
        .select("id,safety_screen_id,submission_media_id,category,severity,confidence,description,start_ms,end_ms,bounding_box,detector,resolution_status,resolution_reason")
        .in("safety_screen_id", screenIds).order("created_at")
    : { data: [] };
  const findingsByScreen = new Map<string, SafetyFinding[]>();
  for (const finding of (safetyFindings ?? []) as SafetyFinding[]) {
    findingsByScreen.set(finding.safety_screen_id, [...(findingsByScreen.get(finding.safety_screen_id) ?? []), finding]);
  }
  const safetyReviews = (safetySummaries ?? []).map((summary) => ({
    ...summary,
    finding_count: Number(summary.finding_count),
    unresolved_finding_count: Number(summary.unresolved_finding_count),
    findings: findingsByScreen.get(summary.safety_screen_id) ?? [],
  })) as CaptureSafetyReview[];

  const withdrawalCaptureIds = (withdrawalRequests ?? []).map((row) => row.capture_id);
  const { data: withdrawalCaptures } = withdrawalCaptureIds.length
    ? await supabase
        .from("review_queue")
        .select("id, student, idea_title")
        .in("id", withdrawalCaptureIds)
    : { data: [] };
  const withdrawalCaptureById = new Map(
    (withdrawalCaptures ?? []).map((row) => [row.id, row]),
  );
  const withdrawals: WithdrawalRow[] = (withdrawalRequests ?? []).flatMap((request) => {
    const capture = withdrawalCaptureById.get(request.capture_id);
    return capture ? [{
      id: request.id,
      captureId: request.capture_id,
      student: capture.student,
      ideaTitle: capture.idea_title,
      reason: request.reason,
      requestedAt: request.requested_at,
    }] : [];
  });

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-6xl px-5 py-6">
        {error ? (
          <p className="text-sm" style={{ color: "var(--clay)" }}>
            {error.message}
          </p>
        ) : (
          <ReviewQueue
            rows={(data ?? []) as QueueRow[]}
            withdrawals={withdrawals}
            safetyReviews={safetyReviews}
            filter={state ?? "open"}
          />
        )}
      </main>
    </>
  );
}
