import Link from "next/link";
import type { Person } from "@/lib/types";

export function AppHeader({ person }: { person: Person }) {
  const isStaff = person.role === "reviewer" || person.role === "admin";

  return (
    <header className="border-b" style={{ borderColor: "var(--rule)" }}>
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
        <Link href="/" className="font-mono text-xs font-semibold uppercase tracking-[0.16em]">
          Capture
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/submissions" style={{ color: "var(--muted)" }}>
            Yours
          </Link>
          {isStaff && (
            <Link href="/review" style={{ color: "var(--muted)" }}>
              Queue
            </Link>
          )}
          <span className="label hidden sm:inline">{person.display_name}</span>
        </nav>
      </div>
    </header>
  );
}
