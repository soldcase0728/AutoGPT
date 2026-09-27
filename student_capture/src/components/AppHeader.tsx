import Link from "next/link";
import type { Person } from "@/lib/types";
import { SignOutButton } from "./SignOutButton";
import { BRAND } from "@/lib/brand";

export function AppHeader({ person }: { person: Person }) {
  const isStaff = person.role === "reviewer" || person.role === "admin";

  return (
    <header className="border-b" style={{ borderColor: "var(--rule)", borderTop: "4px solid var(--brand)" }}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
        <Link
          href={person.role === "admin" ? "/admin" : isStaff ? "/review" : "/"}
          className="flex items-center gap-2"
          aria-label={`${BRAND.appName} home`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a 30px local mark needs no optimiser */}
          <img src={BRAND.logo} alt="" width={30} height={30} className="brand-mark p-[2px]" />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em]">
            <span style={{ color: "var(--brand-ink)" }}>{BRAND.shortName}</span> Capture
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {!isStaff && (
            <Link href="/submissions" style={{ color: "var(--muted)" }}>
              My shots
            </Link>
          )}
          {person.role === "admin" && (
            <Link href="/admin" style={{ color: "var(--muted)" }}>
              Overview
            </Link>
          )}
          {isStaff && (
            <Link href="/review" style={{ color: "var(--muted)" }}>
              Queue
            </Link>
          )}
          {person.role === "admin" && (
            <>
              <Link href="/admin/tasks" style={{ color: "var(--muted)" }}>
                Tasks
              </Link>
              <Link href="/admin/people" style={{ color: "var(--muted)" }}>
                People
              </Link>
            </>
          )}
          <span className="label" title={person.email}>{person.display_name}</span>
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
