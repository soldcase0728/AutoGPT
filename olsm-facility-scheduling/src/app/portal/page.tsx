import type { Metadata } from "next";
import Link from "next/link";
import { DocumentStatus, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { isAdmin } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatRange } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { DOCUMENT_LABELS } from "@/domain/compliance";

export const metadata: Metadata = { title: "My requests" };

export default async function PortalPage() {
  const user = await requireUser();

  // Admins land here from a link; show them their own bookings, not everyone's.
  const bookings = await prisma.booking.findMany({
    where: { requesterId: user.id },
    include: {
      subSpace: { include: { facility: true } },
      invoices: true,
      documents: true,
    },
    orderBy: { startAt: "desc" },
    take: 50,
  });

  const outstandingDocs = bookings.flatMap((b) =>
    b.documents.filter(
      (d) => d.status !== DocumentStatus.SIGNED && d.status !== DocumentStatus.UPLOADED,
    ).map((d) => ({ doc: d, booking: b })),
  );

  const unpaid = bookings.flatMap((b) =>
    b.invoices.filter((i) => i.status === InvoiceStatus.ISSUED).map((i) => ({ invoice: i, booking: b })),
  );

  const upcoming = bookings.filter((b) => b.endAt >= new Date());
  const past = bookings.filter((b) => b.endAt < new Date());

  return (
    <AppShell user={user}>
      <PageHeader
        title="My requests"
        description="Everything you have asked for, what it still needs, and what it cost."
        action={
          user.role === "EXTERNAL" ? (
            <Link
              href="/request"
              className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
            >
              New request
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-5">
        {(outstandingDocs.length > 0 || unpaid.length > 0) && (
          <Card title="Waiting on you">
            <div className="space-y-3">
              {outstandingDocs.map(({ doc, booking }) => (
                <Alert key={doc.id} tone="warn" title={DOCUMENT_LABELS[doc.type]}>
                  <p>
                    Required for {booking.title} ({booking.reference}).{" "}
                    {doc.type === "CERTIFICATE_OF_INSURANCE"
                      ? "Upload a certificate that is valid on the day of the booking."
                      : "Sign to move this booking forward."}
                  </p>
                  <p className="mt-1">
                    <Link href={`/portal/bookings/${booking.id}`} className="font-medium underline">
                      Open booking
                    </Link>
                  </p>
                </Alert>
              ))}

              {unpaid.map(({ invoice, booking }) => (
                <Alert key={invoice.id} tone="warn" title={`Invoice ${invoice.number}`}>
                  <p>
                    {formatMoney(invoice.totalCents)} due for {booking.title}.
                    {invoice.dueAt ? ` Payment due ${invoice.dueAt.toDateString()}.` : ""}
                  </p>
                  <p className="mt-1">
                    <Link href={`/portal/invoices/${invoice.id}`} className="font-medium underline">
                      Pay now
                    </Link>
                  </p>
                </Alert>
              ))}
            </div>
          </Card>
        )}

        <Card title="Upcoming bookings">
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing coming up">
              {user.role === "EXTERNAL" ? (
                <Link href="/request" className="underline">
                  Request a facility
                </Link>
              ) : (
                <Link href="/book" className="underline">
                  Book a space
                </Link>
              )}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-navy-100">
              {upcoming.map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/portal/bookings/${booking.id}`}
                      className="font-medium text-navy-900 hover:underline"
                    >
                      {booking.title}
                    </Link>
                    <p className="text-sm text-navy-600">
                      {formatRange(booking.startAt, booking.endAt)} ·{" "}
                      {booking.subSpace.facility.name} — {booking.subSpace.name}
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card title="Past bookings">
            <ul className="divide-y divide-navy-100">
              {past.slice(0, 20).map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/portal/bookings/${booking.id}`} className="hover:underline">
                      {booking.title}
                    </Link>
                    <p className="text-sm text-navy-600">
                      {formatRange(booking.startAt, booking.endAt)}
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {isAdmin(user.role) && (
        <p className="mt-4 text-sm text-navy-600">
          Looking for everyone&apos;s bookings? Use the{" "}
          <Link href="/calendar" className="underline">
            facility calendar
          </Link>
          .
        </p>
      )}
    </AppShell>
  );
}
