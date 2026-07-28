import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { allowedActivityTypes, canBookFacility, isAdmin } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui";
import { formatRange, instantToLocalDate } from "@/lib/time";
import { ACTIVITY_DESCRIPTIONS, ACTIVITY_LABELS } from "@/domain/rules-engine";
import { checkAnnualAgreement } from "@/domain/compliance";
import { QuickBookForm, type BookOption, type SpaceOption } from "./quick-book-form";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = { title: "Book a space" };

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; subSpace?: string; start?: string; end?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  if (user.role === "EXTERNAL") redirect("/request");

  // The Annual Coach Agreement gate is shown up front rather than after the
  // coach has filled in the whole form.
  const documents = await prisma.document.findMany({ where: { userId: user.id } });
  const agreement = checkAnnualAgreement(user.role, documents);

  const facilities = await prisma.facility.findMany({
    where: { active: true },
    include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });

  const bookable = facilities.filter((f) =>
    canBookFacility({ role: user.role, facilityScope: user.facilityScope }, f),
  );

  const spaces: SpaceOption[] = bookable.flatMap((facility) =>
    facility.subSpaces.map((sub) => ({
      id: sub.id,
      label: `${facility.name} — ${sub.name}`,
      facilityName: facility.name,
      capacity: sub.capacity,
      requiresSupervision: facility.requiresSupervision,
    })),
  );

  const activities: BookOption[] = allowedActivityTypes(user.role).map((value) => ({
    value,
    label: ACTIVITY_LABELS[value],
    description: ACTIVITY_DESCRIPTIONS[value],
  }));

  const sports = await prisma.sport.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  const myWaitlist = await prisma.waitlistEntry.findMany({
    where: { userId: user.id, fulfilledAt: null, windowEnd: { gte: new Date() } },
    include: { subSpace: { include: { facility: true } } },
    orderBy: { windowStart: "asc" },
    take: 10,
  });

  // Sports the coach is assigned to come first; that is the common case.
  const mySportIds = new Set(user.sports.map((s) => s.sportId));
  const sortedSports = [
    ...sports.filter((s) => mySportIds.has(s.id)),
    ...sports.filter((s) => !mySportIds.has(s.id)),
  ];

  const supervisors = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["HEAD_COACH", "ASSISTANT_COACH", "TRAINER", "STRENGTH_COACH", "FACILITY_ADMIN", "SUPER_ADMIN"] },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="Book a space"
        description="In-season team practice by a head coach confirms immediately. Anything paid, external or out-of-season routes through approval first."
      />

      {!agreement.ok ? (
        <Card>
          <Alert tone="warn" title="Your Annual Coach Agreement is not on file">
            <p>{agreement.message}</p>
            <p className="mt-2">
              <a href="/my-documents" className="font-medium underline">
                Sign your Annual Coach Agreement
              </a>{" "}
              — it takes a minute, once a year, and then booking is self-service for the rest of the
              season.
            </p>
          </Alert>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="New booking">
              <QuickBookForm
                spaces={spaces}
                activities={activities}
                sports={sortedSports.map((s) => ({ id: s.id, name: s.name }))}
                supervisors={supervisors}
                defaultDate={params.date ?? instantToLocalDate(new Date())}
                defaultSubSpaceId={params.subSpace}
                defaultStartTime={params.start}
                defaultEndTime={params.end}
                isAdmin={isAdmin(user.role)}
                defaultSportId={user.sports[0]?.sportId}
                defaultTeamLevel={user.sports[0]?.teamLevel}
              />
            </Card>
          </div>

          <aside className="space-y-4">
            <Card title="What happens next">
              <ul className="space-y-3 text-sm text-navy-700">
                <li>
                  <strong className="block text-navy-900">In-season practice, head coach</strong>
                  Confirmed on the spot. No contract, no approval, no payment.
                </li>
                <li>
                  <strong className="block text-navy-900">Assistant coach practice</strong>
                  One-click OK from your head coach.
                </li>
                <li>
                  <strong className="block text-navy-900">Paid instruction, club or rental</strong>
                  Admin approval, then contract, waiver, certificate of insurance and payment. This
                  applies to head coaches too.
                </li>
              </ul>
            </Card>

            <Card title="Space is held while you wait">
              <p className="text-sm text-navy-700">
                From the moment a request is submitted, nobody else can take that slot. Holds expire
                if the documents or payment are not completed in time, and the time returns to open
                inventory.
              </p>
            </Card>

            <Card
              title="Everything you want is taken?"
              description="Join the waitlist and you will hear the moment that window frees up."
            >
              {myWaitlist.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm text-navy-700">
                  {myWaitlist.map((entry) => (
                    <li key={entry.id}>
                      {entry.subSpace.facility.name} — {entry.subSpace.name},{" "}
                      {formatRange(entry.windowStart, entry.windowEnd)}
                      {entry.notifiedAt && (
                        <span className="block text-xs text-emerald-800">
                          A slot opened — check the calendar.
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <WaitlistForm
                spaces={spaces.map((s) => ({ id: s.id, label: s.label }))}
                defaultDate={params.date ?? instantToLocalDate(new Date())}
                activities={activities.map((a) => ({ value: a.value, label: a.label }))}
              />
            </Card>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
