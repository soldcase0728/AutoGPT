import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PublicShell } from "@/components/app-shell";
import { Alert, Card } from "@/components/ui";
import { formatRange } from "@/lib/time";
import { DOCUMENT_LABELS } from "@/domain/compliance";
import { SignForm } from "./sign-form";
import { AGREEMENT_TERMS, WAIVER_TERMS } from "./terms";

export const metadata: Metadata = { title: "Sign document", robots: { index: false } };

/**
 * Public signing page. The token is the only credential -- that is deliberate,
 * because participants signing a waiver do not have OLSM accounts. Tokens are
 * 24 random bytes and single-purpose.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const document = await prisma.document.findUnique({
    where: { publicToken: token },
    include: {
      booking: {
        include: { subSpace: { include: { facility: true } }, organization: true },
      },
      user: true,
    },
  });

  if (!document) notFound();

  const alreadySigned = document.status === DocumentStatus.SIGNED;
  const terms =
    document.type === "ANNUAL_COACH_AGREEMENT" ? AGREEMENT_TERMS : WAIVER_TERMS;

  return (
    <PublicShell>
      <div className="mx-auto max-w-2xl space-y-4">
        <Card
          title={DOCUMENT_LABELS[document.type]}
          description={
            document.booking
              ? `${document.booking.title} · ${document.booking.subSpace.facility.name} — ${document.booking.subSpace.name} · ${formatRange(document.booking.startAt, document.booking.endAt)}`
              : "Annual agreement for OLSM coaching staff"
          }
        >
          {alreadySigned ? (
            <Alert tone="success" title="Already signed">
              This document was signed
              {document.signedAt ? ` on ${document.signedAt.toDateString()}` : ""} by{" "}
              {document.signerName}. Nothing further is needed.
            </Alert>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto rounded border border-navy-200 bg-navy-50 p-4 text-sm leading-relaxed text-navy-800">
                {terms.map((paragraph, i) => (
                  <p key={i} className={i > 0 ? "mt-3" : undefined}>
                    {paragraph}
                  </p>
                ))}
              </div>

              <div className="mt-4">
                <SignForm
                  documentId={document.id}
                  defaultName={document.signerName ?? document.user?.name ?? ""}
                />
              </div>
            </>
          )}
        </Card>

        <p className="text-xs text-navy-600">
          This is placeholder agreement language for the build. Final wording must be reviewed by
          OLSM&apos;s counsel before the system is used for real bookings.
        </p>
      </div>
    </PublicShell>
  );
}
