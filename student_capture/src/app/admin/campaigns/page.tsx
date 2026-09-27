import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CampaignManager } from "./CampaignManager";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, starts_on, ends_on, active, ideas(id)")
    .eq("org_id", me.org_id)
    .order("starts_on", { ascending: false });
  return (
    <>
      <AppHeader person={me} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <CampaignManager
          today={new Date().toISOString().slice(0, 10)}
          campaigns={(campaigns ?? []).map((c) => ({
            id: c.id, name: c.name, startsOn: c.starts_on, endsOn: c.ends_on, active: c.active,
            taskCount: ((c.ideas as unknown as Array<unknown>) ?? []).length,
          }))}
        />
      </main>
    </>
  );
}
