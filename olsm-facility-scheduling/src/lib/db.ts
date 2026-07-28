import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Postgres error codes we translate into domain errors. */
export const PG = {
  EXCLUSION_VIOLATION: "23P01",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  INSUFFICIENT_PRIVILEGE: "42501",
} as const;

export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { code?: string; meta?: { code?: string } };
  // Prisma surfaces raw-query Postgres codes under meta.code and P2010.
  return e.meta?.code ?? (e.code?.startsWith("2") || e.code?.startsWith("4") ? e.code : undefined);
}

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
