import type { SupabaseClient } from "@supabase/supabase-js";

export interface AssignResult {
  created: number;
  skipped: Array<{ name: string; dueOn: string }>;
}

/**
 * Gives `studentIds` the task on each of `dates`, skipping any day a student
 * already has a task (one task per day). Every student must be active on the
 * caller's roster. Runs with the service role; the caller checks the admin.
 */
export async function assignTask(
  admin: SupabaseClient,
  input: { orgId: string; ideaId: string; studentIds: string[]; dates: string[] },
): Promise<AssignResult | { error: string; status: number }> {
  const studentIds = [...new Set(input.studentIds)];
  if (!studentIds.length || !input.dates.length) return { created: 0, skipped: [] };

  const { data: students } = await admin
    .from("people")
    .select("id, display_name")
    .eq("org_id", input.orgId)
    .eq("role", "student")
    .eq("participation", "active")
    .is("deactivated_at", null)
    .in("id", studentIds);
  if ((students ?? []).length !== studentIds.length) {
    return { status: 400, error: "One or more selected students are not active on your school roster." };
  }

  const first = [...input.dates].sort()[0]!;
  const last = [...input.dates].sort().at(-1)!;
  const { data: existing, error: existingError } = await admin
    .from("assignments")
    .select("person_id, due_on")
    .in("person_id", studentIds)
    .gte("due_on", first)
    .lte("due_on", last);
  if (existingError) return { status: 500, error: existingError.message };

  const requested = input.dates.flatMap((due_on) =>
    studentIds.map((person_id) => ({ idea_id: input.ideaId, person_id, due_on })),
  );
  const occupied = new Set((existing ?? []).map((row) => `${row.person_id}:${row.due_on}`));
  const available = requested.filter((row) => !occupied.has(`${row.person_id}:${row.due_on}`));
  if (available.length) {
    const { error } = await admin.from("assignments").insert(available);
    if (error) return { status: 500, error: error.message };
  }

  const names = new Map((students ?? []).map((s) => [s.id as string, s.display_name as string]));
  return {
    created: available.length,
    skipped: requested
      .filter((row) => occupied.has(`${row.person_id}:${row.due_on}`))
      .map((row) => ({ name: names.get(row.person_id) ?? "A student", dueOn: row.due_on })),
  };
}
