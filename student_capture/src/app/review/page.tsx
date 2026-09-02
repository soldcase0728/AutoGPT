import { AppHeader } from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import type { QueueRow } from "@/lib/types";
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
            filter={state ?? "open"}
          />
        )}
      </main>
    </>
  );
}
