import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

/** Records (or clears) where a posted capture lives, so the student can see it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can add post links.");
  }

  const body = await readJson<{ url?: string }>(request);
  const url = body?.url?.trim() ?? "";
  if (url && !/^https:\/\/\S+$/i.test(url)) {
    return fail(400, "Paste the full link to the post, starting with https://.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_capture_post_url", {
    p_capture_id: id,
    p_url: url || null,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return fail(503, "Post links need the latest database migration. See student_capture/README.md.");
    }
    if (error.code === "42501") return fail(403, error.message);
    if (error.code === "23514") return fail(409, error.message);
    return fail(500, error.message);
  }
  return json({ ok: true, url: url || null });
}
