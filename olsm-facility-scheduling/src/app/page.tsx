import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PublicShell } from "@/components/app-shell";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Athletic facility scheduling",
  description:
    "Reserve Orchard Lake St. Mary's Preparatory athletic facilities. Practices for OLSM teams, " +
    "rentals for outside clubs and community groups.",
  robots: { index: false, follow: false },
};

/**
 * Four doors, because four different people arrive here wanting different
 * things and only one of them wants a directory.
 *
 * A signed-in user is still sent straight to the screen their role uses -- a
 * coach does not need a landing page every morning. This is what a signed-out
 * visitor sees, and previously they were redirected into the facility
 * directory, which answers "what spaces exist" when the question is usually
 * "how do I book one" or "where has my request got to".
 */
const PATHS = [
  {
    href: "/sign-in",
    title: "Schedule a team practice",
    audience: "OLSM coaches and staff",
    body: "Sign in with your school account. In-season practice by a head coach is confirmed on the spot — no approval, no paperwork, no payment.",
    primary: true,
  },
  {
    href: "/request",
    title: "Rent a facility",
    audience: "Clubs, travel teams, camps and community groups",
    body: "Start a request without an account. Tell us when and where, and the slot is held while the athletic office reviews it.",
    primary: true,
  },
  {
    href: "/portal",
    title: "My reservations",
    audience: "Anyone with a request in progress",
    body: "Check where a request stands, sign an agreement or waiver, upload a certificate of insurance, and pay an invoice.",
    primary: false,
  },
  {
    href: "/sign-in",
    title: "Administration",
    audience: "Athletic office, finance, facilities and security",
    body: "Approvals, the master calendar, setup boards, documents, payments and reports.",
    primary: false,
  },
] as const;

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    switch (user.role) {
      case Role.FACILITIES:
        redirect("/custodial");
      case Role.FINANCE:
        redirect("/admin/reports");
      case Role.EXTERNAL:
        redirect("/portal");
      default:
        redirect("/calendar");
    }
  }

  return (
    <PublicShell>
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-navy-900">Athletic facility scheduling</h1>
        <p className="mt-2 max-w-2xl text-navy-700">
          One schedule for Orchard Lake St. Mary&apos;s Preparatory athletic spaces — used by school
          teams, and rented to outside groups when it is free.
        </p>
      </div>

      <h2 className="sr-only">What would you like to do?</h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {PATHS.map((path) => (
          <li key={path.title}>
            <Link
              href={path.href}
              className="block h-full rounded-lg border border-navy-200 bg-white p-5 shadow-sm transition hover:border-navy-400 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-600 focus-visible:ring-offset-2"
            >
              <span className="text-lg font-semibold text-navy-900">{path.title}</span>
              <span className="mt-0.5 block text-xs font-medium uppercase tracking-wide text-navy-500">
                {path.audience}
              </span>
              <span className="mt-2 block text-sm text-navy-700">{path.body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card title="Browse the facilities">
          <p className="text-sm text-navy-700">
            Eight spaces, indoor and outdoor, from the stadium to the weight room. Capacity,
            amenities, published hours and what each is available for.
          </p>
          <Link
            href="/facilities"
            className="mt-2 inline-block text-sm font-medium text-navy-800 underline"
          >
            See all facilities
          </Link>
        </Card>

        <Card title="Renting for the first time?">
          <p className="text-sm text-navy-700">
            Outside groups need a signed facility use agreement, a liability waiver and a certificate
            of insurance naming the school as an additional insured. Nothing is confirmed until those
            and payment are complete.
          </p>
          <Link
            href="/request"
            className="mt-2 inline-block text-sm font-medium text-navy-800 underline"
          >
            Start a request
          </Link>
        </Card>
      </div>
    </PublicShell>
  );
}
