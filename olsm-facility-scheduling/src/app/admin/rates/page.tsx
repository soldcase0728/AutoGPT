import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { RATE_TIER_LABELS } from "@/domain/pricing";
import { RateRow } from "./rate-row";

export const metadata: Metadata = { title: "Rate cards" };

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>;
}) {
  const user = await requirePermission("rates:manage");
  const params = await searchParams;

  const facilities = await prisma.facility.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  const facilityId = params.facility ?? facilities[0]?.id;

  const rateCards = await prisma.rateCard.findMany({
    where: { facilityId, effectiveTo: null },
    orderBy: [{ activityType: "asc" }, { rateTier: "asc" }],
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="Rate cards"
        description="Hourly and full-day rates by facility, use and requester type. Editing a rate never changes an invoice that has already been issued."
      />

      <div className="mb-5">
        <Alert tone="warn" title="Every figure below is a placeholder">
          The seeded rates are illustrative only. Set real numbers with the athletic office and the
          business office before the system takes a single external booking. Editing them here takes
          effect immediately; no deployment is needed.
        </Alert>
      </div>

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Facility</span>
            <select
              name="facility"
              defaultValue={facilityId}
              className="rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Show rates
          </button>
        </form>
      </Card>

      <div className="space-y-3">
        {rateCards.map((card) => (
          <Card
            key={card.id}
            title={ACTIVITY_LABELS[card.activityType]}
            description={RATE_TIER_LABELS[card.rateTier]}
          >
            <RateRow
              rate={{
                id: card.id,
                hourlyCents: card.hourlyCents,
                flatDayCents: card.flatDayCents,
                minHours: card.minHours,
              }}
            />
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
