import Link from "next/link";
import type { Person } from "@/lib/types";
import { SignOutButton } from "./SignOutButton";

export function AppHeader({ person }: { person: Person }) {
  const isStaff = person.role === "reviewer" || person.role === "admin";

  return (
    <header className="border-b" style={{ borderColor: "var(--rule)" }}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
        <Link href={isStaff ? "/review" : "/"} className="font-mono text-xs font-semibold uppercase tracking-[0.16em]">
          Capture
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {!isStaff && (
            <Link href="/submissions" style={{ color: "var(--muted)" }}>
              Yours
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
