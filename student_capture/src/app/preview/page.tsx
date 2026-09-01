import Link from "next/link";
import { notFound } from "next/navigation";

const SCREENS = [
  ["today", "Student · today's prompt"],
  ["today-done", "Student · already sent"],
  ["capture", "Student · the capture flow"],
  ["consent", "Student · the release, as a minor sees it"],
  ["submissions", "Student · what they have sent"],
  ["review", "Marketing · the review queue"],
  ["poster", "Print · the QR poster for a locker room wall"],
];

export default function PreviewIndex() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <p className="label">Development only</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Screens</h1>
      <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
        Every screen rendered from fixtures, with no Supabase behind it. These use the
        same view components as the real pages.
      </p>
      <ul className="mt-6 flex flex-col gap-2">
        {SCREENS.map(([slug, label]) => (
          <li key={slug}>
            <Link href={`/preview/${slug}`} className="card block p-4 hover:opacity-80">
              <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>
                /preview/{slug}
              </span>
              <span className="mt-1 block text-[15px]">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
