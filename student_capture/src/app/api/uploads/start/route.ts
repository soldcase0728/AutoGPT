import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { captureObjectName } from "@/lib/storage-key";
import { publicEnv } from "@/lib/env";
import { fail, json, readJson } from "@/lib/http";

interface Body {
  assignmentId: string;
  filename: string;
  mime: string;
  bytes: number;
  kind: "video" | "photo";
}

/**
 * Reserves a capture row and an object key. The file itself never touches this
 * server — the phone uploads straight to storage over a resumable session, and
 * calls /submit when it lands.
 */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const body = await readJson<Body>(request);
  if (!body?.assignmentId || !body.filename) {
    return fail(400, "assignmentId and filename are required.");
  }

  const maxBytes = publicEnv.maxUploadBytes();
  if (!Number.isFinite(body.bytes) || body.bytes <= 0) {
    return fail(400, "A positive byte count is required.");
  }
  if (body.bytes > maxBytes) {
    return fail(413, `That file is larger than the ${maxBytes} byte limit.`);
  }

  const supabase = await createClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, person_id, completed_at")
    .eq("id", body.assignmentId)
    .maybeSingle();

  if (assignmentError) return fail(500, assignmentError.message);
  if (!assignment) return fail(404, "That prompt is not assigned to you.");
  if (assignment.person_id !== person.id) {
    return fail(403, "That prompt belongs to someone else.");
  }
  if (assignment.completed_at) {
    return fail(409, "You have already submitted for this prompt.");
  }

  const captureId = crypto.randomUUID();
  const bucket = publicEnv.captureBucket();
  const objectName = captureObjectName(person.id, captureId, body.filename);

  // Inserted through the caller's own session, so the RLS insert policy is the
  // thing that decides whether this is allowed.
  const { error } = await supabase.from("captures").insert({
    id: captureId,
    assignment_id: assignment.id,
    person_id: person.id,
    org_id: person.org_id,
    bucket,
    storage_key: objectName,
    kind: body.kind === "photo" ? "photo" : "video",
    mime: body.mime || null,
    master_bytes: body.bytes,
    state: "uploading",
  });

  if (error) return fail(500, error.message);

  return json({ captureId, bucket, objectName });
}
