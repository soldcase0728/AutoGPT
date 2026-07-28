import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PublicShell } from "@/components/app-shell";
import { Alert, Card } from "@/components/ui";
import { formatRange } from "@/lib/time";
import { WAIVER_TERMS } from "@/app/sign/[token]/terms";
import { PublicWaiverForm } from "./public-waiver-form";

export const metadata: Metadata = { title: "Sign a waiver", robots: { index: false } };

/**
 * The shared participant link. One URL per booking, handed out by the
 * organiser; each person who opens it signs for themselves.
 *
 * Unauthenticated by design — a parent dropping a child at a Saturday clinic is
 * never going to have an account. The token is the credential, and it exposes
 * only what someone standing in the gym already knows: what the activity is,
 * where, and when.
 */
export default async function PublicWaiverPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const booking = await prisma.booking.findUnique({
    where: { waiverToken: token },
    include: {
      subSpace: { include: { facility: true } },
      organization: true,
    },
  });

  if (!booking) notFound();

  const finished = booking.endAt < new Date();
  const cancelled = ["CANCELLED", "DENIED", "EXPIRED"].includes(booking.status);

  return (
    <PublicShell>
      <div className="mx-auto max-w-2xl space-y-4">
        <Card
          title="Liability waiver and release"
          description={
            <>
              {booking.title}
              <span className="block">
                {booking.subSpace.facility.name} — {booking.subSpace.name}
              </span>
              <span className="block">{formatRange(booking.startAt, booking.endAt)}</span>
              {booking.organization && booking.organization.type !== "INTERNAL" && (
                <span className="block">Organised by {booking.organization.name}</span>
              )}
            </>
          }
        >
          {cancelled ? (
            <Alert tone="warn" title="This activity is not going ahead">
              The booking was cancelled, so no waiver is needed. Check with the organiser.
            </Alert>
          ) : finished ? (
            <Alert tone="warn" title="This activity has finished">
              Waivers cannot be signed after the fact. Contact the athletic office if you believe
              this is wrong.
            </Alert>
          ) : (
            <>
              <p className="mb-3 text-sm text-navy-700">
                Everyone using an Orchard Lake St. Mary&apos;s facility signs a release. If you are
                signing for someone under 18, tick the box and sign as their parent or guardian.
              </p>

              <div className="max-h-80 overflow-y-auto rounded border border-navy-200 bg-navy-50 p-4 text-sm leading-relaxed text-navy-800">
                {WAIVER_TERMS.map((paragraph, i) => (
                  <p key={i} className={i > 0 ? "mt-3" : undefined}>
                    {paragraph}
                  </p>
                ))}
              </div>

              <div className="mt-4">
                <PublicWaiverForm token={token} />
              </div>
            </>
          )}
        </Card>

        <p className="text-xs text-navy-600">
          This is placeholder release language for the build and has not been reviewed by counsel.
          Final wording must be approved before this system is used for real bookings.
        </p>
      </div>
    </PublicShell>
  );
}
