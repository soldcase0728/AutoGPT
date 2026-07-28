"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Last-resort boundary. Next.js scrubs the message in production, so this shows
 * the digest rather than pretending to explain -- an admin can find the matching
 * server log line by digest.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-navy-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-navy-700">
          The action did not complete. Nothing was booked, charged or cancelled by the request that
          failed.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-navy-500">Reference: {error.digest}</p>
        )}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-navy-300 px-3.5 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
