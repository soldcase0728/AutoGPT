import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PublicShell } from "@/components/app-shell";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Facility directory",
  robots: { index: false },
};

/**
 * Rendered per request, not prerendered at build time.
 *
 * This page reads facilities from the database. Static prerendering would bake
 * the directory into the build -- so a facility added or renamed in the admin
 * UI would never appear -- and would require a reachable database during
 * `docker build`, which there isn't one.
 */
export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const facilities = await prisma.facility.findMany({
    where: { active: true },
    include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });

  return (
    <PublicShell>
      <PageHeader
        title="Athletic facilities"
        description="Orchard Lake St. Mary's Preparatory athletic spaces available for school and community use."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {facilities.map((facility) => (
          <Card
            key={facility.id}
            title={
              <Link href={`/facilities/${facility.slug}`} className="hover:underline">
                {facility.name}
              </Link>
            }
            description={facility.type}
          >
            <p className="text-sm text-navy-700">{facility.description}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{facility.indoor ? "Indoor" : "Outdoor"}</Badge>
              <Badge>Capacity {facility.capacity.toLocaleString()}</Badge>
              {facility.externallyBookable ? (
                <Badge tone="good">Available to outside groups</Badge>
              ) : (
                <Badge tone="warn">School use only</Badge>
              )}
              {facility.requiresSupervision && <Badge tone="warn">Supervision required</Badge>}
            </div>

            <p className="mt-3 text-sm text-navy-600">
              {facility.subSpaces.length} bookable space
              {facility.subSpaces.length === 1 ? "" : "s"}:{" "}
              {facility.subSpaces.map((s) => s.name).join(", ")}
            </p>

            <p className="mt-3">
              <Link href={`/facilities/${facility.slug}`} className="text-sm font-medium underline">
                Rates and availability
              </Link>
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Card title="Want to book one of these?">
          <p className="text-sm text-navy-700">
            Outside organisations, clubs and travel teams can submit a request without an OLSM
            account. Requests go through approval, a facility use agreement, a liability waiver, a
            certificate of insurance and payment before they are confirmed.
          </p>
          <Link
            href="/request"
            className="mt-3 inline-block rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Request a facility
          </Link>
        </Card>
      </div>
    </PublicShell>
  );
}
