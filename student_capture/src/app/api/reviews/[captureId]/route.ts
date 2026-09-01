import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import type { CaptureState } from "@/lib/types";

const DECISIONS: CaptureState[] = [
  "in_review",
  "approved",
  "changes_requested",
  "rejected",
  "published",
];

interface Body {
  decision: CaptureState;
  note?: string;
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
    return fail(400, "Say what needs changing — the student only sees the note.");
  }

  const supabase = await createClient();

  // State first. The publish barrier lives in the database, so a refused
  // publish must not leave a review row claiming the capture went out.
  const { error: stateError } = await supabase
    .from("captures")
    .update({ state: body.decision })
    .eq("id", captureId);

  if (stateError) {
    const admin = createAdminClient();
    const { data: blockers } = await admin.rpc("capture_consent_blockers", {
      p_capture_id: captureId,
    });
    if (blockers && Array.isArray(blockers) && blockers.length > 0) {
      return fail(409, "This capture is not cleared for publication.", { blockers });
    }
    return fail(500, stateError.message);
  }

  const { error: reviewError } = await supabase.from("reviews").insert({
    capture_id: captureId,
    reviewer_id: person.id,
    state: body.decision,
    note: body.note?.trim() || null,
  });
  if (reviewError) return fail(500, reviewError.message);

  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    org_id: person.org_id,
    actor_id: person.id,
    action: `capture.${body.decision}`,
    subject_type: "capture",
    subject_id: captureId,
    detail: { note: body.note?.trim() || null },
  });

  return json({ ok: true, state: body.decision });
}
