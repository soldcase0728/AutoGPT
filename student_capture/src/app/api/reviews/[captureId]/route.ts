import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import type { CaptureState } from "@/lib/types";

const DECISIONS: CaptureState[] = [
  "approved",
  "changes_requested",
  "rejected",
  "published",
];

interface Body {
  decision: CaptureState;
  /** Shown to the student. */
  note?: string;
  /** Staff only. */
  internalNote?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  const { captureId } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can review captures.");
  }

  const body = await readJson<Body>(request);
  if (!body?.decision || !DECISIONS.includes(body.decision)) {
    return fail(400, `decision must be one of: ${DECISIONS.join(", ")}.`);
  }
  if (body.decision === "changes_requested" && !body.note?.trim()) {
    return fail(400, "Write a message to the student saying what to change.");
  }
  if (body.decision === "rejected" && !body.note?.trim()) {
    return fail(400, "Write a message to the student saying why it wasn't accepted.");
  }

  const supabase = await createClient();

  // One RPC locks the row and writes the state, review, and audit entry in the
  // same transaction. The database transition graph is the final authority.
  const { data, error: stateError } = await supabase.rpc("review_capture", {
    p_capture_id: captureId,
    p_decision: body.decision,
    p_note: body.note?.trim() || null,
    p_internal_note: body.internalNote?.trim() || null,
  });

  if (stateError) {
    const { data: blockers } = await supabase.rpc("capture_publication_blockers", {
      p_capture_id: captureId,
    });
    if (blockers && Array.isArray(blockers) && blockers.length > 0) {
      return fail(409, "This capture is not cleared for publication.", { blockers });
    }
    return fail(stateError.code === "23514" ? 409 : 500, stateError.message);
  }
  return json({ ok: true, state: data });
}
