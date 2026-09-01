import { AppHeader } from "@/components/AppHeader";
import type { Person } from "@/lib/types";

export function ConsentView({
  person,
  minor,
  ageUnknown,
  releaseVersion,
  children,
}: {
  person: Person;
  minor: boolean;
  ageUnknown: boolean;
  releaseVersion: string;
  /** The signing form. Passed in so the view stays a server component. */
  children: React.ReactNode;
}) {
  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-2xl px-5 py-8">
        <p className="label">One-time · {releaseVersion}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Before you send us anything
        </h1>

        <section className="card mt-5 p-5 text-[15px] leading-relaxed">
          <p>
            You are giving Northside permission to use the photos and clips you send
            through this app on our social accounts and in our own marketing.
          </p>
          <ul className="mt-4 flex flex-col gap-2" style={{ color: "var(--muted)" }}>
            <li>— You keep owning what you shoot. This is permission, not a transfer.</li>
            <li>— We never sell it, and we never license it to anyone else.</li>
            <li>
              — You can withdraw this at any time. When you do, anything already posted
              that you appear in comes down.
            </li>
            <li>
              — Anyone else recognisable in your clip needs to have signed this too
              before it can be posted.
            </li>
          </ul>
        </section>

        {minor && (
          <section
            className="card mt-4 p-5 text-[15px] leading-relaxed"
            style={{ borderColor: "var(--clay)" }}
          >
            <p className="label" style={{ color: "var(--clay)" }}>
              Also needed
            </p>
            <p className="mt-2">
              Our records say you are under 18
              {ageUnknown && " (or we do not have your year of birth)"}. A parent or
              guardian also has to sign, on paper, before anything you send can be
              posted. You can still shoot and submit today — the marketing desk will hold
              it until that is on file.
            </p>
          </section>
        )}

        {children}
      </main>
    </>
  );
}
