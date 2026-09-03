import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function screenBelongsToCapture(
  supabase: SupabaseClient,
  screenId: string,
  captureId: string,
) {
  const { data } = await supabase.from("safety_screens")
    .select("id")
    .eq("id", screenId)
    .eq("capture_id", captureId)
    .maybeSingle();
  return Boolean(data);
}

export async function findingBelongsToCapture(
  supabase: SupabaseClient,
  findingId: string,
  captureId: string,
) {
  const { data: finding } = await supabase.from("safety_findings")
    .select("safety_screen_id")
    .eq("id", findingId)
    .maybeSingle();
  if (!finding) return false;
  return screenBelongsToCapture(supabase, finding.safety_screen_id, captureId);
}
