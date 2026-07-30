import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
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

  // Deliberately not a decimal list. The form beside this one numbers its own
  // four steps, and a second list numbered from 1 sitting next to it made
  // "step 3" mean two different things on one screen. This is the path a
  // request travels after the form is done, so it reads as stages rather than
  // as steps the reader is being asked to take now.
  const stages = [
    ["Submitted", "The slot is checked for conflicts and held for you straight away."],
    ["Under review", "The athletic office approves or declines the request."],
    ["Agreement and waiver", "You sign a facility use agreement and a liability waiver."],
    ["Insurance", "You upload a certificate valid through the date of your booking."],
    ["Payment", "You pay the invoice."],
    ["Confirmed", "The booking is confirmed only once everything above is complete."],
  ] as const;

  const intro = (
    <Card title="How a request becomes a booking">
      <ol className="space-y-2 text-sm text-navy-700">
        {stages.map(([stage, detail]) => (
          <li key={stage} className="flex gap-2">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-navy-400" />
            <span>
              <span className="font-medium text-navy-900">{stage}</span> — {detail}
            </span>
          </li>
        ))}
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
          description="For club, travel, private-instruction and outside-organization use."
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

  // Signed out, and self-service requests are closed. Say who to ask rather
  // than showing a form the server would reject -- the whole point of the
  // earlier work on misleading buttons.
  if (!env.allowAnonymousRequests) {
    return (
      <PublicShell>
        <PageHeader
          title="Request a facility"
          description="Facility requests are made from an account."
        />
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Sign in to request a facility">
              <p className="text-sm text-navy-700">
                OLSM coaches and staff sign in with their school account.
              </p>
              <p className="mt-2 text-sm text-navy-700">
                Outside groups — clubs, travel teams, camps and community organizations — are set up
                with an account by the athletic office. Contact them and they will invite you, then
                you can request facilities, sign documents and pay invoices here.
              </p>
              <Link
                href="/sign-in"
                className="mt-4 inline-block rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
              >
                Sign in
              </Link>
            </Card>
          </div>
          <aside className="space-y-4">
            {intro}
            <Card title="Looking around first?">
              <Link href="/facilities" className="text-sm font-medium underline">
                Browse the facilities
              </Link>
            </Card>
          </aside>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <PageHeader
        title="Request a facility"
        description="Clubs, travel teams and outside organizations. No OLSM account needed to start."
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
