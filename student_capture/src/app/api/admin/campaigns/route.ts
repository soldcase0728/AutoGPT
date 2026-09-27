import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { campaignSchema } from "@/lib/campaign";


export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can create campaigns.");
  const parsed = campaignSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Give the campaign a name and a start date.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ org_id: person.org_id, name: parsed.data.name, starts_on: parsed.data.startsOn, ends_on: parsed.data.endsOn, active: parsed.data.active })
    .select("id")
    .single();
  if (error) return fail(500, error.message);
  return json({ ok: true, id: data.id });
}
