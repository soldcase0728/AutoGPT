import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ssoConfigured } from "@/lib/auth/google";
import { entraConfigured } from "@/lib/auth/entra";
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
          {entraConfigured() && (
            <a
              href="/api/auth/entra"
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-md border border-navy-300 bg-white px-4 py-2.5 text-sm font-medium text-navy-800 hover:bg-navy-50"
            >
              Continue with your OLSM Microsoft account
            </a>
          )}

          {ssoConfigured() && (
            <a
              href="/api/auth/google"
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-md border border-navy-300 bg-white px-4 py-2.5 text-sm font-medium text-navy-800 hover:bg-navy-50"
            >
              Continue with your OLSM Google account
            </a>
          )}

          {/*
            The local fallback. Present because somebody has to be able to get
            in when the tenant is unreachable or a directory change locks staff
            out -- but it is a fallback, so say so once SSO is available rather
            than presenting two equal choices.
          */}
          {entraConfigured() && (
            <p className="mb-3 text-xs text-navy-600">
              Or sign in with an email address and password issued by the athletic office.
            </p>
          )}

          <SignInForm />
        </Card>

        <Card title="Outside organization?">
          <p className="text-sm text-navy-700">
            Clubs, travel teams and outside groups are set up with an account by the athletic
            office. Contact them and they will invite you.
          </p>
          <Link
            href="/facilities"
            className="mt-2 inline-block text-sm font-medium text-navy-800 underline"
          >
            Browse the facilities
          </Link>
        </Card>
      </div>
    </PublicShell>
  );
}
