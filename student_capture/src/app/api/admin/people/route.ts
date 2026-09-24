import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { temporaryPassword } from "@/lib/people";

const createSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["student", "reviewer", "admin"]),
  birthYear: z.number().int().min(1900).max(2100).nullable(),
  activate: z.boolean().default(true),
});

/** Adds someone to the roster and gives them a login with a temporary password. */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can add people.");

  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return fail(400, "Give a name, a valid email, a role, and a birth year or leave it blank.");
  }
  const input = parsed.data;

  // Roster row first, through the admin's own session so RLS decides. The
  // auth trigger links the login to it when the login is created below.
  const supabase = await createClient();
  const { data: row, error: insertError } = await supabase
    .from("people")
    .insert({
      org_id: person.org_id,
      role: input.role,
      display_name: input.displayName,
      email: input.email,
      birth_year: input.birthYear,
      participation: input.activate ? "active" : "pending",
      participation_changed_at: input.activate ? new Date().toISOString() : null,
      participation_changed_by: input.activate ? person.id : null,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return fail(409, "Someone with that email is already on the roster.");
    return fail(500, insertError.message);
  }

  const password = temporaryPassword();
  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
  });
  if (authError) {
    // The roster row stays; a login that already exists can be reset from the list.
    return json({
      ok: true,
      id: row.id,
      password: null,
      warning: /already|registered|exists/i.test(authError.message)
        ? "They're on the roster, but a login with that email already exists. Use Reset password on their row."
        : `They're on the roster, but the login couldn't be created: ${authError.message}`,
    });
  }
  return json({ ok: true, id: row.id, password });
}
