import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { RuleEditor } from "./rule-editor";

export const metadata: Metadata = { title: "Approval rules" };

export default async function RulesPage() {
  const user = await requirePermission("rules:manage");

  const rules = await prisma.rule.findMany({
    orderBy: [{ priorityRank: "asc" }, { activityType: "asc" }],
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="Approval rules"
        description="What each kind of request requires, and how requests rank against each other when they want the same space."
      />

      <div className="mb-5">
        <Alert tone="info" title="Activity type is matched before requester role">
          A rule with a specific role applies to that role; a rule with no role is the fallback for
          everyone else. Because activity type is matched first, a head coach requesting private
          instruction is held to the private-instruction rule, not their head-coach rule. That is
          what stops paid outside work from slipping through as routine team activity.
          <br />
          <br />
          Editing a rule changes what <em>future</em> bookings require. Bookings already created keep
          the rule they were created under, so a change never rewrites history.
        </Alert>
      </div>

      <div className="space-y-4">
        {rules.map((rule) => (
          <Card
            key={rule.id}
            title={ACTIVITY_LABELS[rule.activityType]}
            description={
              rule.requesterRole
                ? `When requested by: ${ROLE_LABELS[rule.requesterRole]}`
                : "Fallback for any requester without a more specific rule"
            }
          >
            {rule.notes && <p className="mb-3 text-sm text-navy-600">{rule.notes}</p>}
            <RuleEditor
              rule={{
                id: rule.id,
                requiresAdminApproval: rule.requiresAdminApproval,
                requiresHeadCoachApproval: rule.requiresHeadCoachApproval,
                requiresContract: rule.requiresContract,
                requiresWaiver: rule.requiresWaiver,
                requiresCoi: rule.requiresCoi,
                requiresPayment: rule.requiresPayment,
                autoApprove: rule.autoApprove,
                mhsaaComplianceFlag: rule.mhsaaComplianceFlag,
                priorityRank: rule.priorityRank,
                refundFullDays: rule.refundFullDays,
                refundPartialDays: rule.refundPartialDays,
                refundPartialPercent: rule.refundPartialPercent,
                documentHoldHours: rule.documentHoldHours,
                paymentHoldHours: rule.paymentHoldHours,
              }}
            />
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
