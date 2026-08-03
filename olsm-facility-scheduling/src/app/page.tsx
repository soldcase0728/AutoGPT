import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
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
function paths(anonymousRequestsOpen: boolean) {
  return [
    {
      href: "/sign-in",
      title: "Schedule a team practice",
      audience: "OLSM coaches and staff",
      body: "Sign in with your school account. In-season practice by a head coach is confirmed on the spot — no approval, no paperwork, no payment.",
    },
    {
      // What this door promises depends on how the site is configured, and
      // getting it wrong is worse than saying less: a renter told to "start a
      // request" who lands on "sign in, and you have no account" has been sent
      // somewhere they cannot go.
      href: anonymousRequestsOpen ? "/request" : "/sign-in",
      title: "Rent a facility",
      audience: "Clubs, travel teams, camps and community groups",
      body: anonymousRequestsOpen
        ? "Start a request without an account. Tell us when and where, and the slot is held while the athletic office reviews it."
        : "Outside groups book with an account the athletic office sets up for you. Ask them to add you and you can request time, sign documents and pay here.",
    },
    {
      href: "/portal",
      title: "My reservations",
      audience: "Anyone with a request in progress",
      body: "Check where a request stands, sign an agreement or waiver, upload a certificate of insurance, and pay an invoice.",
    },
    {
      href: "/sign-in",
      title: "Administration",
      audience: "Athletic office, finance, facilities and security",
      body: "Approvals, the master calendar, setup boards, documents, payments and reports.",
    },
  ];
}

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
        {paths(env.allowAnonymousRequests).map((path) => (
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
            href={env.allowAnonymousRequests ? "/request" : "/sign-in"}
            className="mt-2 inline-block text-sm font-medium text-navy-800 underline"
          >
            {env.allowAnonymousRequests ? "Start a request" : "Sign in to request time"}
          </Link>
        </Card>
      </div>
    </PublicShell>
  );
}
