import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { PublicShell } from "@/components/app-shell";
import { Alert, Card } from "@/components/ui";

/**
 * One-time link used for email verification and for giving an external
 * requester access without making them invent a password up front. The token is
 * a Session row, so it expires on its own and is consumed on use.
 */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const session = await prisma.session.findUnique({ where: { id: token } });

  if (!session || session.expiresAt < new Date()) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-md">
          <Card title="That link has expired">
            <Alert tone="warn">
              Sign-in links are good for a limited time. Ask the athletic office to send a new one,
              or sign in with your email address and password.
            </Alert>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-md">
          <Card title="That account is not available">
            <Alert tone="warn">Contact the athletic office.</Alert>
          </Card>
        </div>
      </PublicShell>
    );
  }

  if (!user.emailVerifiedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }

  // Consume the one-time token, then mint a real session.
  await prisma.session.delete({ where: { id: token } });
  await createSession(user);

  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "auth.verified_link",
    actorId: user.id,
    actorLabel: user.name,
  });

  redirect("/portal");
}
