import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui";
import { FacilityEditor } from "./facility-editor";
import { ConflictGraphEditor } from "./conflict-graph-editor";

export const metadata: Metadata = { title: "Facilities" };

export default async function AdminFacilitiesPage() {
  const user = await requireAdmin();

  const facilities = await prisma.facility.findMany({
    include: { subSpaces: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });

  // Every sub-space is a candidate conflict target, including across
  // facilities — that is how the stadium closes the running track.
  const allSpaces = facilities.flatMap((f) =>
    f.subSpaces.map((s) => ({ id: s.id, label: `${f.name} — ${s.name}` })),
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Facilities and spaces"
        description="Names, capacity, buffers and the conflict rules between spaces."
      />

      <div className="mb-5">
        <Alert tone="info" title="How conflicts work">
          A space lists the other spaces it physically occupies. &ldquo;Full floor&rdquo; lists Court
          A and Court B, so booking the full floor closes both — while Court A and Court B stay
          independent of each other. The relationship works in both directions automatically: you do
          not need to also tell Court A that it blocks the full floor.
        </Alert>
      </div>

      <div className="space-y-5">
        {facilities.map((facility) => (
          <Card
            key={facility.id}
            title={facility.name}
            description={`${facility.type} · ${facility.subSpaces.length} spaces${facility.active ? "" : " · INACTIVE"}`}
          >
            <FacilityEditor
              facility={{
                id: facility.id,
                name: facility.name,
                capacity: facility.capacity,
                bufferMinutes: facility.bufferMinutes,
                externallyBookable: facility.externallyBookable,
                requiresSupervision: facility.requiresSupervision,
                description: facility.description,
                active: facility.active,
              }}
            />

            <div className="mt-5 border-t border-navy-100 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-navy-800">Conflict rules</h3>
              <div className="space-y-4">
                {facility.subSpaces.map((sub) => (
                  <ConflictGraphEditor
                    key={sub.id}
                    subSpace={{ id: sub.id, name: sub.name, blocksIds: sub.blocksIds }}
                    candidates={allSpaces.filter((s) => s.id !== sub.id)}
                  />
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
