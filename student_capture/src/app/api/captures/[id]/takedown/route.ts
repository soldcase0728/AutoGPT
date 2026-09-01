import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

/**
 * Rule 5: protected or prohibited material found after posting comes down.
 *
 * The work is done by `take_down_capture()` in the database, which re-checks
 * staff rights and refuses an empty reason, so this route cannot be the thing
 * that gets it wrong.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const body = await readJson<{ reason?: string }>(request);
  const reason = body?.reason?.trim();
  if (!reason) {
    return fail(400, "A takedown needs a reason — it goes in the permanent record.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("take_down_capture", {
    p_capture_id: id,
    p_reason: reason,
  });

  if (error) {
    // 42501 is the database refusing a non-staff caller.
    if (error.code === "42501") return fail(403, "Only the marketing desk can take a capture down.");
    return fail(500, error.message);
  }

  return json({ ok: true, state: "rejected" });
}
