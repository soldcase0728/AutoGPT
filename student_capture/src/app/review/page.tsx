import { AppHeader } from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import type { QueueRow } from "@/lib/types";
import { ReviewQueue } from "./ReviewQueue";

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

  const { data, error } = await query;

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-6xl px-5 py-6">
        {error ? (
          <p className="text-sm" style={{ color: "var(--clay)" }}>
            {error.message}
          </p>
        ) : (
          <ReviewQueue rows={(data ?? []) as QueueRow[]} filter={state ?? "open"} />
        )}
      </main>
    </>
  );
}
