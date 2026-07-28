import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Button, Card, EmptyState, PageHeader, Table, TableWrap, Td, Th } from "@/components/ui";
import { formatRange } from "@/lib/time";
import { MaintenanceForm } from "@/app/custodial/maintenance-form";
import { deleteBlackoutAction } from "@/app/actions/admin-actions";

export const metadata: Metadata = { title: "Blackouts" };

export default async function BlackoutsPage() {
  const user = await requirePermission("facility:mark-unavailable");

  const [facilities, blackouts] = await Promise.all([
    prisma.facility.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.blackout.findMany({
      where: { endAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      include: { facility: true, subSpace: true },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader
        title="Blackouts and maintenance"
        description="Windows where a space cannot be booked. Existing bookings inside a new blackout are never cancelled silently — you are told about them and decide."
      />

      <div className="space-y-5">
        <Card title="Create a blackout">
          <MaintenanceForm facilities={facilities.map((f) => ({ id: f.id, name: f.name }))} />
        </Card>

        <Card title="Current and upcoming" description="Plus anything that ended in the last 30 days.">
          {blackouts.length === 0 ? (
            <EmptyState title="No blackouts on record" />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Facility</Th>
                    <Th>Space</Th>
                    <Th>Window</Th>
                    <Th>Reason</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {blackouts.map((blackout) => (
                    <tr key={blackout.id}>
                      <Td className="font-medium">{blackout.facility?.name ?? "—"}</Td>
                      <Td>{blackout.subSpace?.name ?? "Whole facility"}</Td>
                      <Td className="whitespace-nowrap">
                        {formatRange(blackout.startAt, blackout.endAt)}
                      </Td>
                      <Td>{blackout.reason}</Td>
                      <Td>
                        <form action={deleteBlackoutAction}>
                          <input type="hidden" name="blackoutId" value={blackout.id} />
                          <Button type="submit" variant="ghost">
                            Remove
                          </Button>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
