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
  { href: "/admin/approvals", label: "Approvals", roles: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN] },
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
            <Link href="/" className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded bg-gold-400 text-sm font-bold text-navy-900"
              >
                OL
              </span>
              <span className="text-sm font-semibold leading-tight">
                OLSM Athletics
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
          <Link href="/facilities" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded bg-gold-400 text-sm font-bold text-navy-900"
            >
              OL
            </span>
            <span className="text-sm font-semibold">OLSM Athletic Facilities</span>
          </Link>
          <nav aria-label="Public" className="flex gap-3 text-sm">
            <Link href="/facilities" className="hover:underline">
              Facilities
            </Link>
            <Link href="/request" className="hover:underline">
              Request a facility
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
