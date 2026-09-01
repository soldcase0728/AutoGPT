import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "../env";

/**
 * Service-role client. Bypasses RLS entirely, so it is only used where the
 * route handler has already established who the caller is and what they may
 * touch: signing URLs, materialising assignments, and writing audit rows.
 */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl(), serverEnv.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
