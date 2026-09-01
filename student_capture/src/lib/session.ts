import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Person } from "./types";

/** The roster row for the signed-in user, or null if they are not on a roster. */
export async function currentPerson(): Promise<Person | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("people")
    .select("id, org_id, auth_user_id, role, display_name, email, birth_year")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (data as Person | null) ?? null;
}

export async function requirePerson(): Promise<Person> {
  const person = await currentPerson();
  if (!person) redirect("/not-on-roster");
  return person;
}

export async function requireStaff(): Promise<Person> {
  const person = await requirePerson();
  if (person.role !== "reviewer" && person.role !== "admin") redirect("/");
  return person;
}

/**
 * The onboarding gate. A student cannot submit anything until their own media
 * release is on file; everyone else in frame is checked at publish time by the
 * database.
 */
export async function hasSignedRelease(personId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("consents")
    .select("id, revoked_at, expires_at")
    .eq("person_id", personId)
    .eq("type", "media_release")
    .is("revoked_at", null);

  const now = Date.now();
  return (data ?? []).some(
    (c: { expires_at: string | null }) =>
      !c.expires_at || new Date(c.expires_at).getTime() > now,
  );
}
