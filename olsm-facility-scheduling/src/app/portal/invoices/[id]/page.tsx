import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { isAdmin } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import { Alert, Button, Card, PageHeader, Table, TableWrap, Td, Th } from "@/components/ui";
import { formatDateTime, formatRange } from "@/lib/time";
import { formatMoney, type LineItem } from "@/domain/pricing";
import { stripeConfigured } from "@/integrations/payments/stripe";
import { recordOfflinePaymentAction, startCheckoutAction } from "@/app/actions/document-actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      booking: {
        include: {
          requester: true,
          organization: true,
          subSpace: { include: { facility: true } },
        },
      },
    },
  });

  if (!invoice) notFound();
  if (invoice.booking.requesterId !== user.id && user.role === "EXTERNAL") notFound();

  const lineItems = (invoice.lineItems as unknown as LineItem[]) ?? [];
  const payable = invoice.status === InvoiceStatus.ISSUED;

  return (
    <AppShell user={user}>
      <PageHeader
        title={`Invoice ${invoice.number}`}
        description={
          <>
            {invoice.booking.title} ·{" "}
            <Link href={`/portal/bookings/${invoice.bookingId}`} className="underline">
              {invoice.booking.reference}
            </Link>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {query.paid && (
            <Alert tone="success" title="Payment received">
              Your booking confirms as soon as Stripe reports the payment as settled. This page
              updates automatically.
            </Alert>
          )}
          {query.cancelled && (
            <Alert tone="info" title="Checkout cancelled">
              Nothing was charged. Your slot is still held until the payment window closes.
            </Alert>
          )}

          <Card title="Charges">
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i}>
                      <Td>{li.label}</Td>
                      <Td className="text-right font-mono">{formatMoney(li.amountCents)}</Td>
                    </tr>
                  ))}
                  <tr>
                    <Td className="font-semibold">Total due now</Td>
                    <Td className="text-right font-mono font-semibold">
                      {formatMoney(invoice.totalCents)}
                    </Td>
                  </tr>
                  {invoice.refundedCents > 0 && (
                    <tr>
                      <Td>Refunded</Td>
                      <Td className="text-right font-mono">−{formatMoney(invoice.refundedCents)}</Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Status">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-navy-600">State</dt>
                <dd className="font-medium">{invoice.status.toLowerCase().replace("_", " ")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-navy-600">Booking</dt>
                <dd>{formatRange(invoice.booking.startAt, invoice.booking.endAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-navy-600">Facility</dt>
                <dd>
                  {invoice.booking.subSpace.facility.name} — {invoice.booking.subSpace.name}
                </dd>
              </div>
              {invoice.dueAt && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-navy-600">Payment due</dt>
                  <dd>{formatDateTime(invoice.dueAt)}</dd>
                </div>
              )}
              {invoice.paidAt && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-navy-600">Paid</dt>
                  <dd>{formatDateTime(invoice.paidAt)}</dd>
                </div>
              )}
            </dl>
          </Card>


          {payable && (
            <Card title="Pay">
              {stripeConfigured() ? (
                <form action={startCheckoutAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <Button type="submit" className="w-full">
                    Pay {formatMoney(invoice.totalCents)}
                  </Button>
                  <p className="mt-2 text-xs text-navy-600">
                    Card or bank transfer through Stripe. The school never sees or stores your card
                    details.
                  </p>
                </form>
              ) : (
                <Alert tone="info" title="Online payment is not enabled yet">
                  Contact the athletic office to arrange payment. Your slot stays held in the
                  meantime.
                </Alert>
              )}

              {isAdmin(user.role) && (
                <form action={recordOfflinePaymentAction} className="mt-4 border-t border-navy-100 pt-4">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-navy-800">
                      Record an offline payment
                    </span>
                    <select
                      name="method"
                      className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
                    >
                      <option value="check">Cheque</option>
                      <option value="cash">Cash</option>
                      <option value="internal_transfer">Internal transfer</option>
                    </select>
                  </label>
                  <Button type="submit" variant="secondary" className="mt-2 w-full">
                    Mark as paid
                  </Button>
                </form>
              )}
            </Card>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
