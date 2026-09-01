import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { alertSafety, safetyMessage } from "@/lib/alerts";

const KINDS = ["unsafe_filming", "protected_material", "prohibited_content", "other"];

interface Body {
  kind: string;
  detail: string;
  captureId?: string;
  ideaId?: string;
}

/**
 * Anyone signed in may raise a safety report — students included, and
 * especially the student who was asked to do something unsafe. It is recorded
 * first and alerted second, so a chat outage cannot lose the report.
 */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");

  const body = await readJson<Body>(request);
  const detail = body?.detail?.trim();
  if (!body?.kind || !KINDS.includes(body.kind)) {
    return fail(400, `kind must be one of: ${KINDS.join(", ")}.`);
  }
  if (!detail) return fail(400, "Tell us what happened, in a sentence.");

  const supabase = await createClient();
  const { data: flag, error } = await supabase
    .from("safety_flags")
    .insert({
      org_id: person.org_id,
      capture_id: body.captureId ?? null,
      idea_id: body.ideaId ?? null,
      reported_by: person.id,
      kind: body.kind,
      detail,
    })
    .select("id")
    .single();

  if (error) return fail(500, error.message);

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", person.org_id)
    .maybeSingle();

  const alert = await alertSafety(
    safetyMessage({
      org: org?.name ?? "Unknown organisation",
      kind: body.kind,
      detail,
      reporter: person.display_name,
      captureId: body.captureId,
      appUrl: new URL(request.url).origin,
    }),
  );

  return json({ ok: true, flagId: flag.id, alert });
}

/** Open reports, for staff. */
export async function GET() {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can read safety reports.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("safety_flags")
    .select("id, kind, detail, capture_id, created_at, acknowledged_at")
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return fail(500, error.message);
  return json({ open: data ?? [] });
}
