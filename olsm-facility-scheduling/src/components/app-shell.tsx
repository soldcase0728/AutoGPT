import Link from "next/link";
import type { ReactNode } from "react";
import { Role } from "@prisma/client";
import { isAdmin, ROLE_LABELS } from "@/lib/auth/rbac";
import type { CurrentUser } from "@/lib/auth/current-user";
import { signOutAction } from "@/app/actions/auth-actions";

interface NavItem {
  href: string;
  label: string;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { href: "/calendar", label: "Calendar" },
  { href: "/book", label: "Book a space", roles: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN, Role.HEAD_COACH, Role.ASSISTANT_COACH, Role.TRAINER, Role.STRENGTH_COACH] },
  { href: "/my-team", label: "My team", roles: [Role.HEAD_COACH, Role.ASSISTANT_COACH] },
  { href: "/my-documents", label: "My documents", roles: [Role.HEAD_COACH, Role.ASSISTANT_COACH, Role.TRAINER, Role.STRENGTH_COACH] },
  { href: "/portal", label: "My requests", roles: [Role.EXTERNAL] },
  { href: "/custodial", label: "Setup board", roles: [Role.FACILITIES, Role.SUPER_ADMIN, Role.FACILITY_ADMIN] },
  // Head coaches too: an assistant's practice request routes to them by name,
  // the page already scopes what they see to their own sport, and decideApproval
  // accepts them as the named approver. Only the link was missing, so the
  // request sat in a queue they had no way to open.
  { href: "/admin/approvals", label: "Approvals", roles: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN, Role.HEAD_COACH] },
  { href: "/admin/reports", label: "Reports", roles: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN, Role.FINANCE] },
  { href: "/admin", label: "Admin", roles: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN] },
];

export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const items = NAV.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="bg-navy-800 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3">
            {/*
              The mark carries the school's initials and the wordmark carries
              the descriptor, so the two never repeat each other. A mark reading
              "OL" beside a wordmark reading "OLSM" ran together as "OLOLSM"
              wherever the text was read rather than laid out -- plain-text
              extraction, a failed stylesheet, an email client. The mark is
              decorative; the link carries its own accessible name.
            */}
            <Link href="/" aria-label="OLSM Athletics, facility scheduling home" className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-8 place-items-center rounded bg-gold-400 px-1.5 text-sm font-bold text-navy-900"
              >
                OLSM
              </span>
              <span aria-hidden className="text-sm font-semibold leading-tight">
                Athletics
                <span className="block text-xs font-normal text-navy-200">Facility scheduling</span>
              </span>
            </Link>

            <div className="flex items-center gap-3 text-sm">
              <div className="hidden text-right sm:block">
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-navy-200">{ROLE_LABELS[user.role]}</p>
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="rounded border border-navy-500 px-2.5 py-1 text-xs hover:bg-navy-700"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded px-3 py-2 text-sm font-medium text-navy-100 hover:bg-navy-700 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-navy-500 sm:px-6">
        Orchard Lake St. Mary&apos;s Preparatory · Athletic facility scheduling
        {isAdmin(user.role) && (
          <>
            {" · "}
            <Link href="/admin/audit" className="underline">
              Audit log
            </Link>
          </>
        )}
      </footer>
    </div>
  );
}

/** Chrome for the public, signed-out pages. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="bg-navy-800 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/facilities"
            aria-label="OLSM Athletic Facilities home"
            className="flex items-center gap-2"
          >
            <span
              aria-hidden
              className="grid h-8 place-items-center rounded bg-gold-400 px-1.5 text-sm font-bold text-navy-900"
            >
              OLSM
            </span>
            <span aria-hidden className="text-sm font-semibold">
              Athletic Facilities
            </span>
          </Link>
          {/*
            Only routes that exist. The brief also lists rental policies, a
            campus map and a contact page; those are not built, and a nav item
            pointing at a 404 is worse than its absence.
          */}
          <nav aria-label="Public" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <Link href="/facilities" className="hover:underline">
              Facilities
            </Link>
            <Link href="/request" className="hover:underline">
              Rent a facility
            </Link>
            <Link href="/portal" className="hover:underline">
              My reservations
            </Link>
            <Link href="/sign-in" className="hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
