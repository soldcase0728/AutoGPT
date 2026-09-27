import "server-only";
import type { createAdminClient } from "./supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** True when a finished object exists at this key. An unfinished resumable upload is not listed. */
export async function objectLanded(admin: Admin, bucket: string, key: string): Promise<boolean> {
  const slash = key.lastIndexOf("/");
  const { data, error } = await admin.storage
    .from(bucket)
    .list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 1 });
  if (error) return false;
  return Boolean(data?.some((object) => object.name === key.slice(slash + 1)));
}
