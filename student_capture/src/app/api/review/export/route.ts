import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

const SIGNED_URL_SECONDS = 60 * 60 * 6;
const EXPORTABLE = ["approved", "published"];

/**
 * Bulk handoff. Returns signed URLs for every approved master, either as JSON
 * or as a plain list that `wget -i list.txt` will happily eat — which is what
 * marketing actually wants at 5pm on a Friday.
 */
export async function GET(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can export captures.");
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "approved";
  if (!EXPORTABLE.includes(state)) {
    return fail(400, `state must be one of: ${EXPORTABLE.join(", ")}.`);
  }
  const asText = url.searchParams.get("format") === "txt";

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("review_queue")
    .select("id, student, idea_title, storage_key, bucket, submitted_at, master_bytes")
    .eq("state", state)
    .order("submitted_at", { ascending: true })
    .limit(500);

  if (error) return fail(500, error.message);

  const eligibleRows = state === "published" ? (rows ?? []) : (await Promise.all(
    (rows ?? []).map(async (row) => ({ row, result: await supabase.rpc("capture_ready_to_post", { p_capture_id: row.id }) })),
  )).filter(({ result }) => result.data === true).map(({ row }) => row);
  const admin = createAdminClient();
  const items = await Promise.all(
    eligibleRows.map(async (row) => {
      const filename = row.storage_key.split("/").pop() ?? "capture";
      const { data } = await admin.storage
        .from(row.bucket)
        .createSignedUrl(row.storage_key, SIGNED_URL_SECONDS, { download: filename });
      return {
        captureId: row.id,
        student: row.student,
        idea: row.idea_title,
        submittedAt: row.submitted_at,
        bytes: row.master_bytes,
        url: data?.signedUrl ?? null,
      };
    }),
  );

  if (asText) {
    const body = items
      .filter((i) => i.url)
      .map((i) => i.url)
      .join("\n");
    return new Response(body + "\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="captures-${state}.txt"`,
      },
    });
  }

  return json({ state, count: items.length, expiresInSeconds: SIGNED_URL_SECONDS, items });
}
