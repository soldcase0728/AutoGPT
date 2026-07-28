import type { Metadata } from "next";
import { DocumentStatus, DocumentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { checkAnnualAgreement } from "@/domain/compliance";
import { UserRoleForm } from "./user-role-form";

export const metadata: Metadata = { title: "People" };

export default async function UsersPage() {
  const user = await requirePermission("user:manage");

  const users = await prisma.user.findMany({
    include: {
      organization: true,
      sports: { include: { sport: true } },
      documents: { where: { type: DocumentType.ANNUAL_COACH_AGREEMENT } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="People"
        description="Roles are assigned here and nowhere else — nobody can choose their own. External requesters self-register but are always created as external."
      />

      <div className="mb-5">
        <Alert tone="info">
          Deactivating an account signs it out on its next request and stops it booking immediately.
        </Alert>
      </div>

      <div className="space-y-3">
        {users.map((u) => {
          const agreement = checkAnnualAgreement(u.role, u.documents);
          const signed = u.documents.some((d) => d.status === DocumentStatus.SIGNED);

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
                  {!u.active && <Badge tone="danger">Inactive</Badge>}
                  {agreement.ok ? (
                    <Badge tone="good">Agreement current</Badge>
                  ) : (
                    <Badge tone="warn">{signed ? "Agreement expired" : "No agreement"}</Badge>
                  )}
                </div>
              }
            >
              {u.id === user.id ? (
                <p className="text-sm text-navy-600">
                  This is your own account; role changes must be made by another administrator.
                </p>
              ) : (
                <UserRoleForm userId={u.id} currentRole={u.role} active={u.active} />
              )}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
