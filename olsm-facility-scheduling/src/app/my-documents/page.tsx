import type { Metadata } from "next";
import Link from "next/link";
import { DocumentStatus, DocumentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/time";
import { checkAnnualAgreement, DOCUMENT_LABELS } from "@/domain/compliance";
import { requestAnnualAgreementAction, sendDocumentAction } from "@/app/actions/document-actions";
import { Button } from "@/components/ui";

export const metadata: Metadata = { title: "My documents" };

export default async function MyDocumentsPage() {
  const user = await requireUser();

  const documents = await prisma.document.findMany({
    where: { userId: user.id },
    include: { booking: { include: { subSpace: { include: { facility: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  const agreement = checkAnnualAgreement(user.role, documents);
  const annual = documents.filter((d) => d.type === DocumentType.ANNUAL_COACH_AGREEMENT);
  const perBooking = documents.filter((d) => d.type !== DocumentType.ANNUAL_COACH_AGREEMENT);
  const outstanding = perBooking.filter(
    (d) =>
        d.status !== DocumentStatus.SIGNED &&
        d.status !== DocumentStatus.ACCEPTED &&
        d.status !== DocumentStatus.SUPERSEDED,
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="My documents"
        description="One agreement a year covers routine team activity. Anything paid or external collects its own paperwork per booking."
      />

      <div className="space-y-5">
        <Card title="Annual Coach Agreement">
          {agreement.ok ? (
            <Alert tone="success" title="On file and current">
              <p>
                Signed and valid
                {agreement.expiresAt ? ` until ${formatDateTime(agreement.expiresAt)}` : ""}. You can
                book self-service for the rest of the school year.
              </p>
            </Alert>
          ) : (
            <Alert tone="warn" title="Required before you can book anything">
              <p>{agreement.message}</p>
              <p className="mt-2">
                It covers facility use rules, supervision responsibilities, emergency and AED
                procedure, concussion protocol acknowledgment, indemnification, and an attestation
                that you will not use school facilities for outside paid instruction without booking
                it as private instruction.
              </p>
            </Alert>
          )}

          <div className="mt-4 space-y-2">
            {annual.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-navy-200 p-3"
              >
                <div>
                  <p className="font-medium">{DOCUMENT_LABELS[doc.type]}</p>
                  <p className="text-sm text-navy-600">
                    {doc.status.toLowerCase().replace("_", " ")}
                    {doc.signedAt ? ` · signed ${formatDateTime(doc.signedAt)}` : ""}
                    {doc.expiresAt ? ` · expires ${formatDateTime(doc.expiresAt)}` : ""}
                  </p>
                </div>
                {doc.status !== DocumentStatus.SIGNED &&
                  (doc.publicToken ? (
                    <Link
                      href={`/sign/${doc.publicToken}`}
                      className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
                    >
                      Sign now
                    </Link>
                  ) : (
                    <form action={sendDocumentAction}>
                      <input type="hidden" name="documentId" value={doc.id} />
                      <Button type="submit" variant="secondary">
                        Send it to me
                      </Button>
                    </form>
                  ))}
              </div>
            ))}

            {annual.length === 0 && (
              <form action={requestAnnualAgreementAction}>
                <Button type="submit">Start my Annual Coach Agreement</Button>
              </form>
            )}
          </div>
        </Card>

        <Card
          title="Per-booking documents"
          description="Contracts, waivers and certificates attached to a specific reservation."
        >
          {perBooking.length === 0 ? (
            <EmptyState title="Nothing outstanding">
              Routine team activity does not collect per-booking paperwork.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-navy-100">
              {perBooking.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{DOCUMENT_LABELS[doc.type]}</p>
                    <p className="text-sm text-navy-600">
                      {doc.booking
                        ? `${doc.booking.title} · ${doc.booking.subSpace.facility.name}`
                        : "Not attached to a booking"}
                    </p>
                  </div>
                  <Badge
                    tone={
                      doc.status === DocumentStatus.SIGNED || doc.status === DocumentStatus.ACCEPTED
                        ? "good"
                        : "warn"
                    }
                  >
                    {doc.status.toLowerCase().replace("_", " ")}
                  </Badge>
                  {doc.publicToken && doc.status !== DocumentStatus.SIGNED && (
                    <Link href={`/sign/${doc.publicToken}`} className="text-sm font-medium underline">
                      Sign
                    </Link>
                  )}
                  {doc.bookingId && (
                    <Link
                      href={`/portal/bookings/${doc.bookingId}`}
                      className="text-sm font-medium underline"
                    >
                      Booking
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}

          {outstanding.length > 0 && (
            <p className="mt-3 text-sm text-navy-700">
              {outstanding.length} document{outstanding.length === 1 ? "" : "s"} outstanding. The
              related bookings stay on hold until these are complete.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
