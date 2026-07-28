/**
 * Booking state machine.
 *
 *   DRAFT
 *     -> PENDING_APPROVAL      rules require admin or head-coach sign-off
 *     -> APPROVED              approver signed off, or auto-approved
 *     -> AWAITING_DOCUMENTS    contract / waiver / COI outstanding
 *     -> AWAITING_PAYMENT      documents complete, invoice issued
 *     -> CONFIRMED             all gates cleared, written to Google Calendar
 *     -> CHECKED_IN            optional day-of confirmation
 *     -> COMPLETED
 *     -> CANCELLED / DENIED / EXPIRED / NO_SHOW
 *
 * The gate order is fixed but gates are skippable: an auto-approved in-season
 * practice goes DRAFT -> CONFIRMED in one transition because none of the
 * intermediate gates apply to it.
 */

import { BookingStatus } from "@prisma/client";

export const TERMINAL_STATES: readonly BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.DENIED,
  BookingStatus.EXPIRED,
  BookingStatus.NO_SHOW,
];

/**
 * States in which a booking holds its slot against everyone else. A booking in
 * one of these states owns a row in booking_occupancy; a booking in any other
 * state owns none.
 */
export const HOLDING_STATES: readonly BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

/**
 * States in which the soft lock is provisional and expires. CONFIRMED and
 * CHECKED_IN hold indefinitely; the rest release automatically.
 */
export const SOFT_LOCK_STATES: readonly BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
];

const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  [BookingStatus.DRAFT]: [
    BookingStatus.PENDING_APPROVAL,
    BookingStatus.APPROVED,
    BookingStatus.AWAITING_DOCUMENTS,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.PENDING_APPROVAL]: [
    BookingStatus.APPROVED,
    BookingStatus.AWAITING_DOCUMENTS,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.DENIED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.APPROVED]: [
    BookingStatus.AWAITING_DOCUMENTS,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
    BookingStatus.DENIED,
  ],
  [BookingStatus.AWAITING_DOCUMENTS]: [
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
    BookingStatus.DENIED,
  ],
  [BookingStatus.AWAITING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    // Payment can fail a document re-check (COI expires while payment is
    // pending); the booking falls back rather than confirming.
    BookingStatus.AWAITING_DOCUMENTS,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
    BookingStatus.DENIED,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.CHECKED_IN,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NO_SHOW,
  ],
  [BookingStatus.CHECKED_IN]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.DENIED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.NO_SHOW]: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal booking transition ${from} -> ${to}`);
  }
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

export function holdsSlot(status: BookingStatus): boolean {
  return HOLDING_STATES.includes(status);
}

export function hasSoftLock(status: BookingStatus): boolean {
  return SOFT_LOCK_STATES.includes(status);
}

export interface GateFlags {
  requiresAdminApproval: boolean;
  requiresHeadCoachApproval: boolean;
  requiresContract: boolean;
  requiresWaiver: boolean;
  requiresCoi: boolean;
  requiresPayment: boolean;
}

export interface GateProgress {
  approvalsCleared: boolean;
  documentsCleared: boolean;
  paymentCleared: boolean;
}

/**
 * The single place that decides where a booking belongs given its gates and
 * how far it has got. Every service that advances a booking calls this rather
 * than hand-rolling an if-chain, which is what keeps "auto-approved practice
 * lands on CONFIRMED immediately" and "external rental waits for money" the
 * same code path.
 */
export function nextStatus(gates: GateFlags, progress: GateProgress): BookingStatus {
  const needsApproval = gates.requiresAdminApproval || gates.requiresHeadCoachApproval;
  if (needsApproval && !progress.approvalsCleared) return BookingStatus.PENDING_APPROVAL;

  const needsDocuments = gates.requiresContract || gates.requiresWaiver || gates.requiresCoi;
  if (needsDocuments && !progress.documentsCleared) return BookingStatus.AWAITING_DOCUMENTS;

  if (gates.requiresPayment && !progress.paymentCleared) return BookingStatus.AWAITING_PAYMENT;

  return BookingStatus.CONFIRMED;
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  AWAITING_DOCUMENTS: "Awaiting documents",
  AWAITING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DENIED: "Denied",
  EXPIRED: "Expired",
  NO_SHOW: "No show",
};
