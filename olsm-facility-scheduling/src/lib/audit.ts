/**
 * Audit log writer.
 *
 * The log is append-only at the database level (see the constraints migration),
 * so there is deliberately no update or delete helper here. Every booking state
 * transition, every approval decision, every refund and every override goes
 * through `recordAudit`.
 */

import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";

export interface AuditEntry {
  entityType: "booking" | "invoice" | "document" | "facility" | "rule" | "user" | "season" | "blackout" | "standing_block" | "organization";
  entityId: string;
  action: string;
  actorId?: string | null;
  actorLabel?: string | null;
  fromState?: string | null;
  toState?: string | null;
  reason?: string | null;
  payload?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
}

export async function recordAudit(entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorLabel: entry.actorLabel ?? null,
      fromState: entry.fromState ?? null,
      toState: entry.toState ?? null,
      reason: entry.reason ?? null,
      payload: entry.payload ?? undefined,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

export async function recordAuditMany(entries: readonly AuditEntry[], tx: Tx = prisma): Promise<void> {
  if (entries.length === 0) return;
  await tx.auditLog.createMany({
    data: entries.map((entry) => ({
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorLabel: entry.actorLabel ?? null,
      fromState: entry.fromState ?? null,
      toState: entry.toState ?? null,
      reason: entry.reason ?? null,
      payload: (entry.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: entry.ipAddress ?? null,
    })),
  });
}

/** Actor label for system-initiated actions (job runner, webhooks). */
export const SYSTEM_ACTOR = "system";
