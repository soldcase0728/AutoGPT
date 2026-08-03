import Link from "next/link";
import type { Metadata } from "next";
import { PublicShell } from "@/components/app-shell";
import { Alert, Card } from "@/components/ui";
import { accessTokenMessage, inspectAccessToken } from "@/lib/auth/access-token";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

// The token is in the path, so there is nothing here worth caching or
// prerendering, and a cached render would be a cached account name.
export const dynamic = "force-dynamic";

/**
 * Where an invitation lands.
 *
 * Rendering this page has no side effects: it reads the token, it does not
 * spend it. That is the whole design. Defender for Office 365 Safe Links
 * follows every URL in inbound mail before the recipient sees it, and OLSM runs
 * Microsoft 365 -- so a link consumed on GET is a link that is always already
 * used by the time a human clicks it. The token is spent when the form below is
 * submitted.
 */
export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const lookup = await inspectAccessToken(token);

  if (!lookup.ok) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-md">
          <Card title="This link cannot be used">
            <Alert tone="warn">{accessTokenMessage(lookup.reason)}</Alert>
            <Link
              href="/sign-in"
              className="mt-3 inline-block text-sm font-medium text-navy-800 underline"
            >
              Go to sign in
            </Link>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const returning = Boolean(lookup.user.passwordHash);

  return (
    <PublicShell>
      <div className="mx-auto max-w-md space-y-4">
        <Card
          title={returning ? "Choose a new password" : `Welcome, ${lookup.user.name.split(" ")[0]}`}
          description={
            returning
              ? "Your current password keeps working until you finish here."
              : "One step and you are in: choose a password for your OLSM facility scheduling account."
          }
        >
          <SetPasswordForm token={token} email={lookup.user.email} />
        </Card>

        <Card title="About this link">
          <p className="text-sm text-navy-700">
            It works once and then stops. If you need another, the athletic office can send one —
            nobody can read your password or reuse this link afterwards.
          </p>
        </Card>
      </div>
    </PublicShell>
  );
}
