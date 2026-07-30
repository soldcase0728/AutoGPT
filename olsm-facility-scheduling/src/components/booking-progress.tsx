import { BookingStatus, DocumentStatus, DocumentType } from "@prisma/client";

/**
 * Where a reservation has got to, and what is owed next.
 *
 * An external booking passes through approval, three documents and a payment
 * before it is confirmed, and a status badge alone ("Awaiting documents")
 * cannot say which document, or whether approval already happened. Without
 * this, finding out means telephoning the athletic office -- which is exactly
 * what the system is meant to remove.
 *
 * Stages are derived from the booking's own records rather than from status
 * alone: status says where the booking is, the documents and invoice say what
 * has actually been satisfied, and a stage can be complete while a later one
 * is outstanding.
 */

export type StageState = "done" | "current" | "todo" | "skipped";

export interface Stage {
  label: string;
  state: StageState;
  detail?: string;
}

interface DocumentLike {
  type: DocumentType;
  status: DocumentStatus;
  isParticipant: boolean;
}

interface InvoiceLike {
  status: string;
}

const SATISFIED: DocumentStatus[] = [DocumentStatus.SIGNED, DocumentStatus.UPLOADED];

const PRE_APPROVAL: BookingStatus[] = [BookingStatus.DRAFT, BookingStatus.PENDING_APPROVAL];

const CONFIRMED_ONWARDS: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.COMPLETED,
];

const TERMINAL: BookingStatus[] = [
  BookingStatus.CANCELLED,
  BookingStatus.DENIED,
  BookingStatus.EXPIRED,
  BookingStatus.NO_SHOW,
];

function documentStage(
  documents: readonly DocumentLike[],
  type: DocumentType,
  label: string,
): Stage | null {
  const owed = documents.filter((d) => d.type === type && !d.isParticipant);
  // A document nobody asked for is not a stage. An in-season practice has
  // none of these, and showing four greyed-out steps would invent ceremony
  // the booking does not have.
  if (owed.length === 0) return null;

  const satisfied = owed.every((d) => SATISFIED.includes(d.status));
  const rejected = owed.some((d) => d.status === DocumentStatus.REJECTED);

  return {
    label,
    state: satisfied ? "done" : "todo",
    detail: rejected ? "Rejected — a corrected copy is needed" : undefined,
  };
}

export function buildStages(
  status: BookingStatus,
  documents: readonly DocumentLike[],
  invoice: InvoiceLike | undefined,
  requiresApproval: boolean,
): Stage[] {
  const stages: Stage[] = [{ label: "Request submitted", state: "done" }];

  if (requiresApproval) {
    const approved = !PRE_APPROVAL.includes(status);
    stages.push({ label: "School approval", state: approved ? "done" : "todo" });
  }

  for (const [type, label] of [
    [DocumentType.FACILITY_USE_AGREEMENT, "Agreement"],
    [DocumentType.LIABILITY_WAIVER, "Waiver"],
    [DocumentType.CERTIFICATE_OF_INSURANCE, "Insurance"],
  ] as const) {
    const stage = documentStage(documents, type, label);
    if (stage) stages.push(stage);
  }

  if (invoice) {
    const paid = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(invoice.status);
    stages.push({ label: "Payment", state: paid ? "done" : "todo" });
  }

  const confirmed = CONFIRMED_ONWARDS.includes(status);
  stages.push({ label: "Confirmed", state: confirmed ? "done" : "todo" });

  // A cancelled or declined booking is not "in progress" through anything, so
  // nothing is marked current -- an arrow pointing at the next step would be
  // telling the reader to do something that no longer matters.
  if (TERMINAL.includes(status)) {
    return stages.map((s) => (s.state === "todo" ? { ...s, state: "skipped" } : s));
  }

  // The first outstanding stage is the one being waited on.
  const next = stages.find((s) => s.state === "todo");
  if (next) next.state = "current";

  return stages;
}

const DOT: Record<StageState, string> = {
  done: "bg-emerald-600 text-white",
  current: "bg-navy-800 text-white",
  todo: "border border-navy-300 bg-white text-navy-500",
  skipped: "border border-navy-200 bg-navy-50 text-navy-400",
};

const TEXT: Record<StageState, string> = {
  done: "text-navy-800",
  current: "font-semibold text-navy-900",
  todo: "text-navy-500",
  skipped: "text-navy-400 line-through",
};

/**
 * Rendered as an ordered list, so a screen reader gets the sequence and the
 * position for free. State is in each item's text as well as its colour --
 * "done", "now", "to do" -- because a tick that is only green is not a status
 * to anyone who cannot see it.
 */
export function BookingProgress({ stages }: { stages: readonly Stage[] }) {
  return (
    <ol className="space-y-2">
      {stages.map((stage, i) => (
        <li key={stage.label} className="flex items-start gap-3">
          <span
            aria-hidden
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${DOT[stage.state]}`}
          >
            {stage.state === "done" ? "✓" : i + 1}
          </span>
          <span className="text-sm">
            <span className={TEXT[stage.state]}>{stage.label}</span>
            <span className="sr-only">
              {stage.state === "done"
                ? " — done"
                : stage.state === "current"
                  ? " — waiting on this now"
                  : stage.state === "skipped"
                    ? " — no longer needed"
                    : " — still to do"}
            </span>
            {stage.state === "current" && (
              <span className="ml-2 rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-800">
                Now
              </span>
            )}
            {stage.detail && (
              <span className="block text-xs text-amber-800">{stage.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
