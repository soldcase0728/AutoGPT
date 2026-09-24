import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { campaignSchema } from "@/lib/campaign";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can change campaigns.");
  const parsed = campaignSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the campaign details.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ name: parsed.data.name, starts_on: parsed.data.startsOn, ends_on: parsed.data.endsOn, active: parsed.data.active })
    .eq("id", id)
    .select("id");
  if (error) return fail(500, error.message);
  if (!data?.length) return fail(404, "That campaign isn't in your school.");
  return json({ ok: true });
}
