"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamBoard as Board } from "@/lib/student-record";

/**
 * Teammates who chose to show up, by first name, with this week's numbers,
 * plus the student's own switch. Off until they turn it on.
 */
export function TeamBoard({ board }: { board: Board }) {
  const router = useRouter();
  const [optedIn, setOptedIn] = useState(board.optedIn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(show: boolean) {
    setSaving(true);
    setError(null);
    setOptedIn(show);
    const response = await fetch("/api/me/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ show }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setOptedIn(!show);
      setError("That didn't save. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--rule)" }}>
      {board.groups.map((group) => (
        <div key={group.name} className="mb-3">
          <p className="text-sm font-semibold">{group.name} board</p>
          {group.entries.length ? (
            <ol className="mt-1 flex flex-col text-sm">
              {group.entries.map((entry, i) => (
                <li
                  key={`${entry.firstName}-${i}`}
                  className="flex justify-between border-t py-1 first:border-t-0 tabular-nums"
                  style={{ borderColor: "var(--rule)" }}
                >
                  <span className={entry.me ? "font-semibold" : undefined}>
                    {entry.firstName}{entry.me ? " (you)" : ""}
                  </span>
                  <span style={{ color: "var(--muted)" }}>
                    {entry.weekSent} sent · {entry.weekPosted} live
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Nobody has joined this board yet.
            </p>
          )}
        </div>
      ))}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={optedIn}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          Show my first name and this week&rsquo;s numbers on my team&rsquo;s board.
          <span className="block" style={{ color: "var(--muted)" }}>
            Only people in your teams and groups see it. Turn it off any time.
          </span>
        </span>
      </label>
      {error && (
        <p className="mt-1 text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</p>
      )}
    </div>
  );
}
