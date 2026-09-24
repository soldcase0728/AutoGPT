import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ConsentRecord } from "@/lib/people";
import { RELEASE_VERSION } from "@/app/consent/version";
import { PeopleManager, type PersonRow } from "./PeopleManager";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: people } = await supabase
    .from("people")
    .select("id, role, display_name, email, birth_year, participation, auth_user_id, deactivated_at")
    .eq("org_id", me.org_id)
    .is("deactivated_at", null)
    .order("display_name");

  const ids = (people ?? []).map((p) => p.id);
  const [{ data: consents }, { data: posted }] = ids.length
    ? await Promise.all([
        supabase
          .from("consents")
          .select("person_id, type, document_version, signed_at, signed_by, expires_at, revoked_at")
          .in("person_id", ids),
        supabase
          .from("capture_people")
          .select("person_id, captures!inner(state)")
          .in("person_id", ids)
          .eq("captures.state", "published"),
      ])
    : [{ data: [] }, { data: [] }];

  const postedCount = new Map<string, number>();
  for (const tag of (posted ?? []) as Array<{ person_id: string }>) {
    postedCount.set(tag.person_id, (postedCount.get(tag.person_id) ?? 0) + 1);
  }

  const rows: PersonRow[] = (people ?? []).map((p) => ({
    id: p.id,
    role: p.role,
    name: p.display_name,
    email: p.email,
    birthYear: p.birth_year,
    participation: p.participation,
    hasLogin: Boolean(p.auth_user_id),
    isMe: p.id === me.id,
    postedCount: postedCount.get(p.id) ?? 0,
    consents: ((consents ?? []) as Array<ConsentRecord & { person_id: string }>).filter(
      (c) => c.person_id === p.id,
    ),
  }));

  return (
    <>
      <AppHeader person={me} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <PeopleManager rows={rows} releaseVersion={RELEASE_VERSION} today={new Date().toISOString().slice(0, 10)} />
      </main>
    </>
  );
}
