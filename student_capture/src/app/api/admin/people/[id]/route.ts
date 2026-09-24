import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { temporaryPassword } from "@/lib/people";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("revoke_access") }),
  z.object({ action: z.literal("restore_access") }),
  z.object({ action: z.literal("set_birth_year"), birthYear: z.number().int().min(1900).max(2100).nullable() }),
  z.object({
    action: z.literal("record_parental"),
    signedBy: z.string().trim().min(2).max(120),
    signedOn: isoDate,
    expiresOn: isoDate.nullable().optional(),
  }),
  z.object({
    action: z.literal("withdraw_release"),
    type: z.enum(["media_release", "parental"]),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({ action: z.literal("reset_password") }),
]);

/** One administrator action on one person. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentPerson();
  if (!me) return fail(401, "Sign in first.");
  if (me.role !== "admin") return fail(403, "Only an administrator can change people.");

  const parsed = actionSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "That change is missing something. Check the form and try again.");
  const body = parsed.data;

  const supabase = await createClient();
  // RLS limits this to the admin's own organisation.
  const { data: target } = await supabase
    .from("people")
    .select("id, email, display_name, auth_user_id, participation")
    .eq("id", id)
    .maybeSingle();
  if (!target) return fail(404, "That person is not on your roster.");

  const now = new Date().toISOString();

  switch (body.action) {
    case "activate":
    case "restore_access":
    case "revoke_access": {
      if (body.action === "revoke_access" && target.id === me.id) {
        return fail(409, "You can't revoke your own access.");
      }
      const participation = body.action === "revoke_access" ? "revoked" : "active";
      const { error } = await supabase
        .from("people")
        .update({ participation, participation_changed_at: now, participation_changed_by: me.id })
        .eq("id", id);
      if (error) return fail(500, error.message);
      return json({ ok: true, participation });
    }

    case "set_birth_year": {
      const { error } = await supabase.from("people").update({ birth_year: body.birthYear }).eq("id", id);
      if (error) return fail(500, error.message);
      return json({ ok: true });
    }

    case "record_parental": {
      if (body.signedOn > now.slice(0, 10)) return fail(400, "The signing date can't be in the future.");
      if (body.expiresOn && body.expiresOn <= body.signedOn) {
        return fail(400, "The expiry date has to be after the signing date.");
      }
      const { error } = await supabase.from("consents").insert({
        person_id: id,
        type: "parental",
        document_version: "parental-paper",
        signed_at: `${body.signedOn}T12:00:00Z`,
        signed_by: body.signedBy,
        expires_at: body.expiresOn ? `${body.expiresOn}T23:59:59Z` : null,
      });
      if (error) return fail(error.code === "42501" ? 403 : 500, error.message);
      return json({ ok: true });
    }

    case "withdraw_release": {
      // The consents_revoke_unpublish trigger pulls anything posted that
      // they appear in back to "approved".
      const { data, error } = await supabase
        .from("consents")
        .update({ revoked_at: now, revoked_reason: body.reason })
        .eq("person_id", id)
        .eq("type", body.type)
        .is("revoked_at", null)
        .select("id");
      if (error) return fail(error.code === "42501" ? 403 : 500, error.message);
      if (!data?.length) return fail(409, "There's no active release of that kind to withdraw.");
      return json({ ok: true });
    }

    case "reset_password": {
      const password = temporaryPassword();
      const admin = createAdminClient();
      let authUserId = target.auth_user_id as string | null;
      if (!authUserId) {
        // A login may already exist under this email; link it rather than
        // trying (and failing) to create a second one.
        const { data: linkedId } = await supabase.rpc("link_person_login", { p_person_id: id });
        authUserId = (linkedId as string | null) ?? null;
      }
      if (authUserId) {
        const { error } = await admin.auth.admin.updateUserById(authUserId, { password });
        if (error) return fail(500, error.message);
      } else {
        const { error } = await admin.auth.admin.createUser({
          email: target.email,
          password,
          email_confirm: true,
        });
        if (error) {
          return fail(
            409,
            /already|registered|exists/i.test(error.message)
              ? "A login with this email belongs to someone else on the roster, so it can't be linked here."
              : error.message,
          );
        }
      }
      return json({ ok: true, password });
    }
  }
}
