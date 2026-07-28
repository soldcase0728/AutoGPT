/**
 * Minimal durable job queue.
 *
 * Calendar writes, e-mail, reminders and expiry sweeps all go through here so
 * a Google outage or a Stripe hiccup never fails a coach's booking request.
 * Retries are exponential with jitter; a job that exhausts its attempts is
 * marked failed and raises an admin alert -- sync failures must never be
 * silent.
 *
 * This is deliberately swappable for Inngest or BullMQ: callers only touch
 * `enqueue`, and the handler registry is a plain map.
 */

import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";

export type JobKind =
  | "calendar.upsert"
  | "calendar.delete"
  | "calendar.revert"
  | "notify.email"
  | "notify.sms"
  | "invoice.reminder"
  | "esign.send";

export interface EnqueueInput {
  kind: JobKind;
  payload: Prisma.InputJsonValue;
  runAt?: Date;
  /** Collapses duplicate enqueues of the same logical operation. */
  idempotencyKey?: string;
  maxAttempts?: number;
}

export async function enqueue(input: EnqueueInput, tx: Tx = prisma): Promise<void> {
  const data = {
    kind: input.kind,
    payload: input.payload,
    runAt: input.runAt ?? new Date(),
    idempotencyKey: input.idempotencyKey ?? null,
    maxAttempts: input.maxAttempts ?? 6,
  };

  if (input.idempotencyKey) {
    // A pending job with the same key is already going to do this work.
    await tx.jobQueue.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: data,
      update: { runAt: data.runAt, payload: data.payload },
    });
    return;
  }

  await tx.jobQueue.create({ data });
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<JobKind, JobHandler>();

export function registerHandler(kind: JobKind, handler: JobHandler): void {
  handlers.set(kind, handler);
}

/** Retry backoff: 1m, 4m, 9m, 16m, 25m ... with jitter. */
function backoffMs(attempts: number): number {
  const base = Math.min(attempts * attempts * 60_000, 3_600_000);
  return base + Math.floor(Math.random() * 30_000);
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  exhausted: { id: string; kind: string; error: string }[];
}

export async function processDueJobs(limit = 25, now: Date = new Date()): Promise<ProcessResult> {
  const due = await prisma.jobQueue.findMany({
    where: { completedAt: null, failedAt: null, runAt: { lte: now } },
    orderBy: { runAt: "asc" },
    take: limit,
  });

  const result: ProcessResult = { processed: 0, succeeded: 0, failed: 0, exhausted: [] };

  for (const job of due) {
    // Claim the job. If another worker already claimed it, skip.
    const claimed = await prisma.jobQueue.updateMany({
      where: { id: job.id, lockedAt: null, completedAt: null, failedAt: null },
      data: { lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    result.processed += 1;
    const handler = handlers.get(job.kind as JobKind);

    try {
      if (!handler) throw new Error(`No handler registered for job kind "${job.kind}".`);
      await handler((job.payload ?? {}) as Record<string, unknown>);
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: { completedAt: new Date(), lockedAt: null, lastError: null },
      });
      result.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = job.attempts + 1;
      const exhausted = attempts >= job.maxAttempts;

      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          lockedAt: null,
          lastError: message.slice(0, 1000),
          failedAt: exhausted ? new Date() : null,
          runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(attempts)),
        },
      });

      result.failed += 1;
      if (exhausted) result.exhausted.push({ id: job.id, kind: job.kind, error: message });
    }
  }

  return result;
}

/** Jobs stuck in a lock from a crashed worker. */
export async function reclaimStuckJobs(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const { count } = await prisma.jobQueue.updateMany({
    where: { lockedAt: { lt: cutoff }, completedAt: null, failedAt: null },
    data: { lockedAt: null },
  });
  return count;
}

/** Test seam. */
export function clearHandlers(): void {
  handlers.clear();
}
