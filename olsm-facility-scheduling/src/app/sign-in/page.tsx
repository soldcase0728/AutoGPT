import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ssoConfigured } from "@/lib/auth/google";
import { PublicShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "EXTERNAL" ? "/portal" : "/calendar");

  return (
    <PublicShell>
      <div className="mx-auto max-w-md space-y-4">
        <Card title="Sign in">
          {/*
            When SSO is unavailable the page simply offers the password form.
            Announcing that a provider is "not configured" tells the reader
            about our deployment rather than about their next step, and reads
            as breakage to anyone who never expected a Google button.
          */}
          {ssoConfigured() && (
            <a
              href="/api/auth/google"
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-md border border-navy-300 bg-white px-4 py-2.5 text-sm font-medium text-navy-800 hover:bg-navy-50"
            >
              Continue with your OLSM Google account
            </a>
          )}

          <SignInForm />
        </Card>

        <Card title="Outside organization?">
          <p className="text-sm text-navy-700">
            Clubs, travel teams and outside groups can request a facility without an OLSM account.
          </p>
          <Link href="/request" className="mt-2 inline-block text-sm font-medium text-navy-800 underline">
            Request a facility
          </Link>
        </Card>
      </div>
    </PublicShell>
  );
}
