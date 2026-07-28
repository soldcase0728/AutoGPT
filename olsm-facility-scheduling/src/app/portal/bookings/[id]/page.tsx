import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentStatus, DocumentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { isAdmin } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { formatDateTime, formatRange } from "@/lib/time";
import { formatMoney, type LineItem } from "@/domain/pricing";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { DOCUMENT_LABELS } from "@/domain/compliance";
import { describePolicy } from "@/domain/cancellation";
import { CancelBookingForm } from "./cancel-form";
import { RosterPanel } from "./roster-panel";
import { DayOfControls } from "./day-of-controls";
import { needsParticipantWaivers, rosterStatus, waiverUrl } from "@/services/participant-service";
import { CoiUploadForm } from "./coi-upload-form";
import { sendDocumentAction } from "@/app/actions/document-actions";
import { Button } from "@/components/ui";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      supervisor: true,
      organization: true,
      sport: true,
      subSpace: { include: { facility: true } },
      documents: true,
      invoices: true,
      approvals: { include: { approver: true } },
      requirements: true,
    },
  });

  if (!booking) notFound();

  // A requester sees their own bookings; staff can see any. An external
  // requester must not be able to enumerate other people's reservations.
  const canView =
    booking.requesterId === user.id || user.role !== "EXTERNAL";
  if (!canView) notFound();

  const invoice = booking.invoices[0];
  // Participant waivers are managed in their own panel; this list is the
  // paperwork the organiser personally owes.
  const organiserDocuments = booking.documents.filter((d) => !d.isParticipant);
  const lineItems = (invoice?.lineItems as unknown as LineItem[]) ?? [];
  const snapshot = (booking.requirements?.ruleSnapshot ?? {}) as {
    refundFullDays?: number;
    refundPartialDays?: number;
    refundPartialPercent?: number;
  };

  const coi = booking.documents.find(
    (d) => d.type === DocumentType.CERTIFICATE_OF_INSURANCE && !d.isParticipant,
  );
  const canManage = booking.requesterId === user.id || isAdmin(user.role);
  const roster = await rosterStatus(booking.id);

  return (
    <AppShell user={user}>
      <PageHeader
        title={booking.title}
        description={`${booking.reference} · requested by ${booking.requester.name}`}
        action={<StatusBadge status={booking.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="When" value={formatRange(booking.startAt, booking.endAt)} />
              <Detail
                label="Where"
                value={`${booking.subSpace.facility.name} — ${booking.subSpace.name}`}
              />
              <Detail label="Activity" value={ACTIVITY_LABELS[booking.activityType]} />
              <Detail label="Sport" value={booking.sport?.name ?? "—"} />
              <Detail label="Organisation" value={booking.organization?.name ?? "—"} />
              <Detail label="Headcount" value={booking.headcount || "—"} />
              <Detail label="Supervisor" value={booking.supervisor?.name ?? "—"} />
              <Detail label="Created" value={formatDateTime(booking.createdAt)} />
              {booking.setupNotes && <Detail label="Setup" value={booking.setupNotes} wide />}
              {booking.equipmentNotes && <Detail label="Equipment" value={booking.equipmentNotes} wide />}
              {booking.cancelReason && <Detail label="Cancellation reason" value={booking.cancelReason} wide />}
            </dl>

            {booking.holdExpiresAt && (
              <div className="mt-4">
                <Alert tone="warn" title="This slot is held, not confirmed">
                  Nobody else can take it until {formatDateTime(booking.holdExpiresAt)}. If the
                  outstanding items are not complete by then, the hold releases and the time returns
                  to open inventory.
                </Alert>
              </div>
            )}

            {booking.calendarSyncStatus === "FAILED" && isAdmin(user.role) && (
              <div className="mt-4">
                <Alert tone="danger" title="Calendar sync failed">
                  {booking.calendarSyncError}
                </Alert>
              </div>
            )}
          </Card>

          <Card title="Documents">
            {organiserDocuments.length === 0 ? (
              <EmptyState title="No documents required">
                Routine team activity is covered by the Annual Coach Agreement.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-navy-100">
                {organiserDocuments.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{DOCUMENT_LABELS[doc.type]}</p>
                      <p className="text-sm text-navy-600">
                        {doc.status.toLowerCase().replace("_", " ")}
                        {doc.signedAt ? ` · signed ${formatDateTime(doc.signedAt)}` : ""}
                        {doc.expiresAt ? ` · valid to ${formatDateTime(doc.expiresAt)}` : ""}
                      </p>
                    </div>
                    <Badge
                      tone={
                        doc.status === DocumentStatus.SIGNED || doc.status === DocumentStatus.UPLOADED
                          ? "good"
                          : "warn"
                      }
                    >
                      {doc.status === DocumentStatus.SIGNED || doc.status === DocumentStatus.UPLOADED
                        ? "Complete"
                        : "Outstanding"}
                    </Badge>
                    {doc.fileUrl && (
                      <Link href={`/api/documents/${doc.id}/file`} className="text-sm underline">
                        Download
                      </Link>
                    )}
                    {canManage &&
                      doc.type !== DocumentType.CERTIFICATE_OF_INSURANCE &&
                      doc.status !== DocumentStatus.SIGNED &&
                      (doc.publicToken ? (
                        <Link href={`/sign/${doc.publicToken}`} className="text-sm font-medium underline">
                          Sign
                        </Link>
                      ) : (
                        <form action={sendDocumentAction}>
                          <input type="hidden" name="documentId" value={doc.id} />
                          <Button type="submit" variant="secondary">
                            Send for signature
                          </Button>
                        </form>
                      ))}
                  </li>
                ))}
              </ul>
            )}

            {coi && canManage && coi.status !== DocumentStatus.UPLOADED && (
              <div className="mt-4 border-t border-navy-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold">Upload certificate of insurance</h3>
                <CoiUploadForm documentId={coi.id} bookingId={booking.id} />
              </div>
            )}
          </Card>

          {needsParticipantWaivers(booking.activityType) && canManage && (
            <Card
              title="Participants"
              description="Everyone using the facility signs a release, not just the person who booked it."
            >
              <RosterPanel
                bookingId={booking.id}
                participants={roster.participants}
                expected={roster.expected}
                signed={roster.signed}
                existingLink={booking.waiverToken ? waiverUrl(booking.waiverToken) : null}
              />
            </Card>
          )}

          {invoice && (
            <Card
              title={`Invoice ${invoice.number}`}
              description={invoice.status.toLowerCase().replace("_", " ")}
              action={
                invoice.status === "ISSUED" ? (
                  <Link
                    href={`/portal/invoices/${invoice.id}`}
                    className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
                  >
                    Pay
                  </Link>
                ) : undefined
              }
            >
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i}>
                        <Td>
                          {li.label}
                          {li.kind === "deposit" && (
                            <span className="block text-xs text-navy-600">
                              Authorised only; released after the rental unless there is damage.
                            </span>
                          )}
                        </Td>
                        <Td className="text-right font-mono">{formatMoney(li.amountCents)}</Td>
                      </tr>
                    ))}
                    <tr>
                      <Td className="font-semibold">Total due</Td>
                      <Td className="text-right font-mono font-semibold">
                        {formatMoney(invoice.totalCents)}
                      </Td>
                    </tr>
                    {invoice.refundedCents > 0 && (
                      <tr>
                        <Td>Refunded</Td>
                        <Td className="text-right font-mono">
                          −{formatMoney(invoice.refundedCents)}
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card title="Approvals">
            {booking.approvals.length === 0 ? (
              <p className="text-sm text-navy-700">
                No approval was required for this booking.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {booking.approvals.map((step) => (
                  <li key={step.id}>
                    <p className="font-medium">
                      {step.status === "PENDING" ? "Awaiting decision" : step.status.toLowerCase()}
                    </p>
                    <p className="text-navy-600">
                      {step.approver ? step.approver.name : (step.requiredRole ?? "Assigned approver")}
                      {step.decidedAt ? ` · ${formatDateTime(step.decidedAt)}` : ""}
                    </p>
                    {step.note && <p className="mt-1 italic text-navy-700">“{step.note}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canManage && !["CANCELLED", "DENIED", "EXPIRED", "COMPLETED", "NO_SHOW"].includes(booking.status) && (
            <Card title="Cancel this booking">
              <p className="mb-3 text-sm text-navy-700">
                {describePolicy({
                  refundFullDays: snapshot.refundFullDays ?? 14,
                  refundPartialDays: snapshot.refundPartialDays ?? 3,
                  refundPartialPercent: snapshot.refundPartialPercent ?? 50,
                })}
              </p>
              <CancelBookingForm bookingId={booking.id} canWaivePolicy={isAdmin(user.role)} />
            </Card>
          )}

          <DayOfControls
            bookingId={booking.id}
            status={booking.status}
            startAt={booking.startAt.toISOString()}
            canCheckIn={canManage || user.role === "FACILITIES"}
            canMarkNoShow={isAdmin(user.role)}
          />

          {isAdmin(user.role) && (
            <Card title="Audit trail">
              <Link href={`/admin/audit?entityId=${booking.id}`} className="text-sm underline">
                View every change to this booking
              </Link>
            </Card>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function Detail({
  label,
  value,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-navy-600">{label}</dt>
      <dd className="mt-0.5 font-medium text-navy-900">{value}</dd>
    </div>
  );
}
