import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { fail, json, readJson } from "@/lib/http";
import { RECENT_WINDOW_DAYS, daysAgo, isoDate, pickIdea } from "@/lib/assign";

interface Body {
  orgSlug?: string;
  dueOn?: string;
  dryRun?: boolean;
}

/**
 * Materialises one prompt per active student for a given day. Idempotent: the
 * unique constraint on (person_id, due_on) means re-running it is a no-op, so a
 * flaky scheduler cannot double-assign.
 *
 * Phase 1 runs this from cron. In phase 2 it becomes the tail of the 7am
 * AutoGPT graph, which also sends the nudges.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-capture-cron-secret");
  if (!secret || secret !== serverEnv.cronSecret()) {
    return fail(401, "Bad or missing x-capture-cron-secret header.");
  }

  const body = (await readJson<Body>(request)) ?? {};
  const dueOn = body.dueOn ?? isoDate(new Date());
  const since = daysAgo(dueOn, RECENT_WINDOW_DAYS);
  const admin = createAdminClient();

  let orgQuery = admin.from("organizations").select("id, slug, name");
  if (body.orgSlug) orgQuery = orgQuery.eq("slug", body.orgSlug);
  const { data: orgs, error: orgError } = await orgQuery;
  if (orgError) return fail(500, orgError.message);

  const results: Array<Record<string, unknown>> = [];

  for (const org of orgs ?? []) {
    const { data: ideas } = await admin
      .from("ideas")
      .select("id, weight, campaigns!inner(org_id, active, starts_on, ends_on)")
      .eq("active", true)
      .eq("campaigns.org_id", org.id)
      .eq("campaigns.active", true)
      .lte("campaigns.starts_on", dueOn);

    // A campaign with no end date runs until it is switched off.
    const live = (ideas ?? []).filter((idea) => {
      const campaign = (idea as unknown as {
        campaigns: { ends_on: string | null };
      }).campaigns;
      return !campaign?.ends_on || campaign.ends_on >= dueOn;
    });

    const { data: students } = await admin
      .from("people")
      .select("id")
      .eq("org_id", org.id)
      .eq("role", "student")
      .is("deactivated_at", null);

    if (live.length === 0 || !students?.length) {
      results.push({ org: org.slug, assigned: 0, reason: "no live ideas or students" });
      continue;
    }

    const { data: existing } = await admin
      .from("assignments")
      .select("person_id")
      .eq("due_on", dueOn)
      .in("person_id", students.map((s) => s.id));
    const alreadyAssigned = new Set((existing ?? []).map((a) => a.person_id));

    const { data: recent } = await admin
      .from("assignments")
      .select("person_id, idea_id")
      .gte("due_on", since)
      .in("person_id", students.map((s) => s.id));

    const recentByPerson = new Map<string, string[]>();
    for (const row of recent ?? []) {
      const list = recentByPerson.get(row.person_id) ?? [];
      list.push(row.idea_id);
      recentByPerson.set(row.person_id, list);
    }

    const rows: Array<{ idea_id: string; person_id: string; due_on: string }> = [];
    for (const student of students) {
      if (alreadyAssigned.has(student.id)) continue;
      const ideaId = pickIdea(
        live.map((i) => ({ id: i.id as string, weight: (i.weight as number) ?? 1 })),
        recentByPerson.get(student.id) ?? [],
      );
      if (ideaId) rows.push({ idea_id: ideaId, person_id: student.id, due_on: dueOn });
    }

    if (!body.dryRun && rows.length > 0) {
      const { error } = await admin
        .from("assignments")
        .upsert(rows, { onConflict: "person_id,due_on", ignoreDuplicates: true });
      if (error) return fail(500, error.message);

      await admin.from("audit_log").insert({
        org_id: org.id,
        action: "assignments.materialised",
        subject_type: "organization",
        subject_id: org.id,
        detail: { due_on: dueOn, count: rows.length },
      });
    }

    results.push({
      org: org.slug,
      assigned: rows.length,
      skipped: alreadyAssigned.size,
      ideaPool: live.length,
    });
  }

  return json({ dueOn, dryRun: Boolean(body.dryRun), results });
}
