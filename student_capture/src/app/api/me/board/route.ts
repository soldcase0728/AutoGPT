import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

/** A student turns their own spot on the team board on or off. */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "student") return fail(403, "Only students appear on the team board.");
  const body = await readJson<{ show?: unknown }>(request);
  if (typeof body?.show !== "boolean") return fail(400, "Say whether to show you on the board.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_board_opt_in", { p_show: body.show });
  if (error) return fail(error.code === "42501" ? 403 : 500, "That didn't save. Try again.");
  return json({ show: body.show });
}
