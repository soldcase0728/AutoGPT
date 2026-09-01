import QRCode from "qrcode";
import { headers } from "next/headers";
import { PosterView } from "@/components/views/PosterView";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * `/poster` — the printable QR card that gets students into the app.
 *
 * Staff only, because it carries the organisation's name and is the thing
 * pinned to a wall. Point it anywhere with ?url=, e.g. at a campaign landing
 * page rather than the app root.
 */
export default async function PosterPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; headline?: string }>;
}) {
  const person = await requireStaff();
  const { url: urlParam, headline } = await searchParams;

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", person.org_id)
    .maybeSingle();

  // A poster is printed and stuck on a wall; only ever encode a web address.
  const target = safeTarget(urlParam) ?? (await appOrigin());
  const qrSvg = await QRCode.toString(target, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#17191a", light: "#ffffff" },
  });

  return (
    <PosterView
      orgName={org?.name ?? "Daily capture"}
      headline={headline || "One clip. Every day."}
      url={target}
      qrSvg={qrSvg}
    />
  );
}

function safeTarget(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function appOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
