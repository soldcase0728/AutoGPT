import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AppShell, PublicShell } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "Not permitted" };

export default async function ForbiddenPage() {
  const user = await getCurrentUser();

  const body = (
    <Card title="You do not have access to that screen">
      <Alert tone="warn">
        {user
          ? `Your account is set up as ${ROLE_LABELS[user.role]}, which does not include that area. ` +
            "If you need access, the athletic office can change it."
          : "Sign in to continue."}
      </Alert>
      <p className="mt-3 text-sm text-navy-700">
        <Link href="/" className="font-medium underline">
          Go back to your home screen
        </Link>
      </p>
    </Card>
  );

  if (!user) {
    return (
      <PublicShell>
        <PageHeader title="Not permitted" />
        {body}
      </PublicShell>
    );
  }

  return (
    <AppShell user={user}>
      <PageHeader title="Not permitted" />
      {body}
    </AppShell>
  );
}
