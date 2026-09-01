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
    .select("id, org_id, auth_user_id, role, display_name, email, birth_year, participation")
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
 * The onboarding gate, asked per version of the wording.
 *
 * Rule 2: someone who has accepted the current wording is never asked again.
 * Rule 3: bumping RELEASE_VERSION means everyone must affirmatively accept the
 * new text — an older signature does not carry forward, and is not overwritten.
 */
export async function hasSignedRelease(
  personId: string,
  version: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_current_release", {
    p_person_id: personId,
    p_version: version,
  });
  // Fail closed: if we cannot prove acceptance, ask for it.
  if (error) return false;
  return data === true;
}
