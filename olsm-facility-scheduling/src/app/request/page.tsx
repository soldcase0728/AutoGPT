import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PublicShell } from "@/components/app-shell";
import { AppShell } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui";
import { ACTIVITY_DESCRIPTIONS, ACTIVITY_LABELS, EXTERNAL_ACTIVITY_TYPES } from "@/domain/rules-engine";
import { instantToLocalDate } from "@/lib/time";
import { RequestWizard } from "./request-wizard";

export const metadata: Metadata = { title: "Request a facility", robots: { index: false } };

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  const facilities = await prisma.facility.findMany({
    where: { active: true, externallyBookable: true },
    include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });

  const spaces = facilities.flatMap((facility) =>
    facility.subSpaces.map((sub) => ({
      id: sub.id,
      label: `${facility.name} — ${sub.name}`,
      facilitySlug: facility.slug,
      capacity: sub.capacity,
    })),
  );

  const activities = EXTERNAL_ACTIVITY_TYPES.map((value) => ({
    value,
    label: ACTIVITY_LABELS[value],
    description: ACTIVITY_DESCRIPTIONS[value],
  }));

  const preselected = params.facility
    ? spaces.find((s) => s.facilitySlug === params.facility)?.id
    : undefined;

  const wizard = (
    <RequestWizard
      spaces={spaces}
      activities={activities}
      defaultDate={instantToLocalDate(new Date(Date.now() + 14 * 86_400_000))}
      defaultSubSpaceId={preselected}
      signedIn={Boolean(user)}
    />
  );

  const intro = (
    <Card title="How an outside request works">
      <ol className="list-inside list-decimal space-y-1 text-sm text-navy-700">
        <li>Tell us what you need and when. The slot is checked for conflicts immediately.</li>
        <li>The athletic office reviews and approves or declines the request.</li>
        <li>You sign a facility use agreement and a liability waiver.</li>
        <li>You upload a certificate of insurance valid through the date of your booking.</li>
        <li>You pay the invoice. The booking is confirmed only after all of the above.</li>
      </ol>
      <p className="mt-3 text-sm text-navy-700">
        Your slot is held from the moment you submit, so nobody else can take it while the paperwork
        is in progress. Holds expire if the steps are not completed in time.
      </p>
    </Card>
  );

  if (user) {
    return (
      <AppShell user={user}>
        <PageHeader
          title="Request a facility"
          description="For club, travel, private-instruction and outside-organisation use."
        />
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Your request">{wizard}</Card>
          </div>
          <aside>{intro}</aside>
        </div>
      </AppShell>
    );
  }

  return (
    <PublicShell>
      <PageHeader
        title="Request a facility"
        description="Clubs, travel teams and outside organisations. No OLSM account needed to start."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Your request">{wizard}</Card>
        </div>
        <aside className="space-y-4">
          {intro}
          <Card title="Already have an account?">
            <Link href="/sign-in" className="text-sm font-medium underline">
              Sign in to see your requests, documents and invoices
            </Link>
          </Card>
        </aside>
      </div>
    </PublicShell>
  );
}
