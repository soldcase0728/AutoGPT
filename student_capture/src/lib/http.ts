import { NextResponse } from "next/server";

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

/** Errors say what went wrong and what to do, never just a status code. */
export function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
