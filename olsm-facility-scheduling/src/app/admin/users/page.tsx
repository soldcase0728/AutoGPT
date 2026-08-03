import type { Metadata } from "next";
import { DocumentStatus, DocumentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ROLE_LABELS, assignableRoles, can } from "@/lib/auth/rbac";
import { emailIsDeliverable } from "@/lib/env";
import { checkAnnualAgreement } from "@/domain/compliance";
import { formatDateTime } from "@/lib/time";
import { NewUserForm } from "./new-user-form";
import { SignInLinkForm } from "./sign-in-link-form";
import { UserRoleForm } from "./user-role-form";

export const metadata: Metadata = { title: "People" };

export default async function UsersPage() {
  // Adding somebody is athletic-office work; changing what they may do is the
  // director's. The page opens on the first and hides the second.
  const user = await requirePermission("user:invite");
  const mayManage = can(user.role, "user:manage");

  const users = await prisma.user.findMany({
    include: {
      organization: true,
      sports: { include: { sport: true } },
      documents: { where: { type: DocumentType.ANNUAL_COACH_AGREEMENT } },
      accessTokens: {
        where: { consumedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const roles = assignableRoles(user.role);
  const neverSignedIn = users.filter((u) => u.active && !u.passwordHash && !u.entraOid).length;

  return (
    <AppShell user={user}>
      <PageHeader
        title="People"
        description="Every account starts here. Signing in with Microsoft or Google never creates one, so somebody who is not on this list cannot get in until you add them."
      />

      <div className="mb-5 space-y-3">
        {!emailIsDeliverable() && (
          <Alert tone="warn">
            No email provider is configured, so invitations cannot be delivered. Adding somebody
            still works — the sign-in link is shown here for you to pass on yourself.
          </Alert>
        )}
        {neverSignedIn > 0 && (
          <Alert tone="info">
            {neverSignedIn === 1
              ? "One person has been added but has never signed in."
              : `${neverSignedIn} people have been added but have never signed in.`}{" "}
            If their link expired, send another.
          </Alert>
        )}
        {mayManage && (
          <Alert tone="info">
            Deactivating an account signs it out on its next request and stops it booking
            immediately. That is the reliable off-switch — removing somebody from a group in Entra
            is not, because a role there can raise authority here but never lower it.
          </Alert>
        )}
      </div>

      <div className="mb-6">
        <Card
          title="Add a person"
          description="Coaches and staff, and the outside groups you rent to. They get one link to choose a password."
        >
          <NewUserForm assignableRoles={roles} />
        </Card>
      </div>

      <div className="space-y-3">
        {users.map((u) => {
          const agreement = checkAnnualAgreement(u.role, u.documents);
          const signed = u.documents.some((d) => d.status === DocumentStatus.SIGNED);
          const activated = Boolean(u.passwordHash || u.entraOid);
          const pendingInvite = u.accessTokens[0];
          const inviteLive = pendingInvite && pendingInvite.expiresAt > new Date();

          return (
            <Card
              key={u.id}
              title={u.name}
              description={
                <>
                  {u.email}
                  {u.organization ? ` · ${u.organization.name}` : ""}
                  {u.sports.length > 0
                    ? ` · ${u.sports.map((s) => `${s.sport.name}${s.isHead ? " (head)" : ""}`).join(", ")}`
                    : ""}
                </>
              }
              action={
                <div className="flex flex-wrap gap-2">
                  <Badge>{ROLE_LABELS[u.role]}</Badge>
                  {/*
                    Where the role came from. Entra can raise a role but never
                    lower it, so removing somebody from an administrator group
                    there does not remove their privileges here. Showing the
                    source makes a role Entra no longer supports visible to the
                    person doing the quarterly review, instead of it sitting
                    unnoticed. Disabling the account is the reliable off-switch.
                  */}
                  <Badge tone={u.entraOid ? undefined : "warn"}>
                    {u.entraOid ? "Microsoft sign-in linked" : "Local sign-in only"}
                  </Badge>
                  {!activated && (
                    <Badge tone="warn">
                      {inviteLive
                        ? `Invited ${formatDateTime(pendingInvite.createdAt)}, not signed in`
                        : "Never signed in — link expired"}
                    </Badge>
                  )}
                  {!u.active && <Badge tone="danger">Inactive</Badge>}
                  {agreement.ok ? (
                    <Badge tone="good">Agreement current</Badge>
                  ) : (
                    <Badge tone="warn">{signed ? "Agreement expired" : "No agreement"}</Badge>
                  )}
                </div>
              }
            >
              <div className="space-y-3">
                {u.active && <SignInLinkForm userId={u.id} activated={activated} />}

                {mayManage &&
                  (u.id === user.id ? (
                    <p className="text-sm text-navy-600">
                      This is your own account; role changes must be made by another administrator.
                    </p>
                  ) : (
                    <UserRoleForm
                      userId={u.id}
                      currentRole={u.role}
                      active={u.active}
                      assignableRoles={roles}
                    />
                  ))}
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
