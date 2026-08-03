import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Card, PageHeader, Stat } from "@/components/ui";
import { formatMoney } from "@/domain/pricing";
import { operationsSummary } from "@/services/reporting-service";

export const metadata: Metadata = { title: "Admin" };

const SECTIONS = [
  { href: "/admin/approvals", title: "Approval queue", blurb: "Decide pending requests." },
  { href: "/admin/allocation", title: "Season allocation", blurb: "Standing blocks and collision resolution." },
  { href: "/admin/facilities", title: "Facilities & spaces", blurb: "Names, buffers, calendars, conflict rules." },
  { href: "/admin/rates", title: "Rate cards", blurb: "Hourly and day rates by tier." },
  { href: "/admin/rules", title: "Approval rules", blurb: "The matrix that decides what each request needs." },
  { href: "/admin/blackouts", title: "Blackouts", blurb: "Maintenance and unavailable windows." },
  { href: "/admin/reports", title: "Reports", blurb: "Utilisation, revenue, compliance." },
  { href: "/admin/users", title: "People", blurb: "Add coaches and outside groups, send sign-in links, set roles." },
  { href: "/admin/audit", title: "Audit log", blurb: "Every change, append-only." },
];

export default async function AdminHome() {
  const user = await requireAdmin();
  const summary = await operationsSummary();

  return (
    <AppShell user={user}>
      <PageHeader title="Administration" description="Everything the athletic office controls." />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pending approvals" value={summary.pendingApprovals} />
        <Stat label="Awaiting documents" value={summary.awaitingDocuments} />
        <Stat label="Awaiting payment" value={summary.awaitingPayment} />
        <Stat label="Unpaid invoices" value={formatMoney(summary.unpaidInvoiceCents)} />
        <Stat
          label="COIs expiring in 30 days"
          value={summary.expiringCoiCount}
          hint={summary.expiringCoiCount > 0 ? "Chase these before they lapse." : undefined}
        />
        <Stat
          label="Unsigned coach agreements"
          value={summary.unsignedAgreementCount}
          hint={summary.unsignedAgreementCount > 0 ? "These accounts cannot book." : undefined}
        />
        <Stat label="Bumped (30 days)" value={summary.bumpedLast30} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Card key={section.href} title={<Link href={section.href} className="hover:underline">{section.title}</Link>}>
            <p className="text-sm text-navy-700">{section.blurb}</p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
