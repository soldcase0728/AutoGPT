"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import {
  RELEASE_LABEL,
  needsParentalRelease,
  releaseStatus,
  type ConsentRecord,
  type ReleaseStatus,
} from "@/lib/people";

export interface PersonRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  name: string;
  email: string;
  birthYear: number | null;
  participation: "pending" | "active" | "revoked";
  hasLogin: boolean;
  isMe: boolean;
  /** Posted items they are tagged in; withdrawing a release pulls these. */
  postedCount: number;
  consents: ConsentRecord[];
}

type Filter = "all" | "pending" | "parental" | "revoked" | "staff";

const STATUS_TONE = { pending: "accent", active: "good", revoked: "bad" } as const;
const STATUS_LABEL = { pending: "Waiting to be activated", active: "Active", revoked: "Access revoked" };

function releaseTone(status: ReleaseStatus) {
  return status === "valid" ? "good" : status === "missing" || status === "outdated" ? "accent" : "bad";
}

async function call(path: string, body: object) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "That didn't save.");
  return payload as { password?: string | null; warning?: string };
}

export function PeopleManager({
  rows,
  releaseVersion,
  today,
}: {
  rows: PersonRow[];
  releaseVersion: string;
  today: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const enriched = useMemo(
    () =>
      rows.map((row) => {
        const own = releaseStatus(row.consents, "media_release", { requiredVersion: releaseVersion });
        const parentalNeeded = row.role === "student" && needsParentalRelease(row.birthYear);
        const parental = parentalNeeded ? releaseStatus(row.consents, "parental") : null;
        return { ...row, own, parental, parentalNeeded };
      }),
    [releaseVersion, rows],
  );

  const counts = {
    pending: enriched.filter((r) => r.participation === "pending").length,
    parental: enriched.filter((r) => r.parentalNeeded && r.parental !== "valid").length,
    revoked: enriched.filter((r) => r.participation === "revoked").length,
  };

  const needle = search.trim().toLowerCase();
  const visible = enriched.filter((row) => {
    if (needle && !`${row.name} ${row.email}`.toLowerCase().includes(needle)) return false;
    if (filter === "pending") return row.participation === "pending";
    if (filter === "parental") return row.parentalNeeded && row.parental !== "valid";
    if (filter === "revoked") return row.participation === "revoked";
    if (filter === "staff") return row.role !== "student";
    return true;
  });

  const filters: Array<[Filter, string, number | null]> = [
    ["all", "Everyone", rows.length],
    ["pending", "Waiting to be activated", counts.pending],
    ["parental", "Needs parent release", counts.parental],
    ["revoked", "Access revoked", counts.revoked],
    ["staff", "Staff", null],
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">School administrator</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">People</h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
            Everyone who can sign in, whether they can take part, and which releases are on file.
            Nothing can be posted of someone without their release, and a parent&rsquo;s for anyone under 18.
          </p>
        </div>
        <button className="btn" onClick={() => setAdding((a) => !a)}>
          {adding ? "Close" : "Add a person"}
        </button>
      </header>

      {adding && <AddPerson onDone={() => setAdding(false)} />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {filters.map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className="rounded-sm border px-3 py-1.5 text-sm"
              style={{
                borderColor: filter === id ? "var(--ink)" : "var(--rule)",
                background: filter === id ? "var(--ink)" : "transparent",
                color: filter === id ? "var(--bg)" : "var(--ink)",
              }}
            >
              {label}
              {count !== null && <span className="ml-1 font-mono text-xs opacity-70">{count}</span>}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search by name or email"
          className="card px-3 py-2 text-sm sm:max-w-sm"
          style={{ background: "var(--surface)" }}
        />
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((row) => (
          <li key={row.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">
                  {row.name} {row.isMe && <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>(you)</span>}
                </p>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {row.email} · {row.role}
                  {row.role === "student" && ` · ${row.birthYear ? `born ${row.birthYear}` : "birth year unknown"}`}
                  {!row.hasLogin && " · no login yet"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tone={STATUS_TONE[row.participation]}>{STATUS_LABEL[row.participation]}</Chip>
                  <Chip tone={releaseTone(row.own)}>Own release: {RELEASE_LABEL[row.own]}</Chip>
                  {row.parental && (
                    <Chip tone={releaseTone(row.parental)}>Parent release: {RELEASE_LABEL[row.parental]}</Chip>
                  )}
                </div>
              </div>
              <button className="btn btn-quiet" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}>
                {open === row.id ? "Done" : "Manage"}
              </button>
            </div>
            {open === row.id && <ManagePerson row={row} today={today} />}
          </li>
        ))}
        {visible.length === 0 && (
          <li className="card p-5 text-sm" style={{ color: "var(--muted)" }}>Nobody matches.</li>
        )}
      </ul>
    </div>
  );
}

function PasswordNotice({ password, email }: { password: string; email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-sm border p-3" style={{ borderColor: "var(--moss)" }} role="status">
      <p className="text-sm font-semibold">Temporary password for {email}</p>
      <p className="mt-1 select-all font-mono text-lg tracking-wide">{password}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Shown once. Give it to them in person or by text; they sign in with it at the app.
      </p>
      <button
        type="button"
        className="mt-2 text-sm underline"
        onClick={() => {
          navigator.clipboard?.writeText(password).then(() => setCopied(true), () => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function AddPerson({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"student" | "reviewer" | "admin">("student");
  const [birthYear, setBirthYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ password: string | null; warning?: string; email: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await call("/api/admin/people", {
        displayName: name,
        email,
        role,
        birthYear: birthYear ? Number(birthYear) : null,
        activate: true,
      });
      setResult({ password: payload.password ?? null, warning: payload.warning, email });
      setName("");
      setEmail("");
      setBirthYear("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card grid gap-4 p-5 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="label">Name as it should appear</span>
        <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">School email</span>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }}>
          <option value="student">Student</option>
          <option value="reviewer">Reviewer (marketing desk)</option>
          <option value="admin">Administrator</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Birth year {role === "student" ? "(decides if a parent must sign)" : "(optional)"}</span>
        <input type="number" min={1900} max={2100} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="2010" className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add and create login"}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
        {error && <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</p>}
      </div>
      {result && (
        <div className="sm:col-span-2">
          {result.password && <PasswordNotice password={result.password} email={result.email} />}
          {result.warning && <p className="text-sm" style={{ color: "var(--clay)" }}>{result.warning}</p>}
        </div>
      )}
    </form>
  );
}

function ManagePerson({ row, today }: {
  row: PersonRow & { own: ReleaseStatus; parental: ReleaseStatus | null; parentalNeeded: boolean };
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [birthYear, setBirthYear] = useState(row.birthYear ? String(row.birthYear) : "");
  const [guardian, setGuardian] = useState("");
  const [signedOn, setSignedOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState("");
  const [withdrawing, setWithdrawing] = useState<"media_release" | "parental" | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function run(body: object, success: string) {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const payload = await call(`/api/admin/people/${row.id}`, body);
      if (payload.password) setPassword(payload.password);
      setDone(success);
      setWithdrawing(null);
      setConfirmRevoke(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-5 border-t pt-4 md:grid-cols-2" style={{ borderColor: "var(--rule)" }}>
      <section className="flex flex-col gap-2">
        <p className="label">Access</p>
        {row.participation === "pending" && (
          <>
            <p className="text-sm">They can sign in, but can&rsquo;t be given tasks or send anything until you activate them.</p>
            <button className="btn self-start" disabled={busy} onClick={() => void run({ action: "activate" }, "Activated.")}>Activate</button>
          </>
        )}
        {row.participation === "active" && !row.isMe && (
          confirmRevoke ? (
            <div className="flex flex-col gap-2 rounded-sm border p-3" style={{ borderColor: "var(--clay)" }}>
              <p className="text-sm">They&rsquo;ll be read-only: no new tasks, uploads or sends. What they already sent stays. To take down posts they&rsquo;re in, withdraw their release instead.</p>
              <div className="flex gap-2">
                <button className="btn" style={{ background: "var(--clay)", borderColor: "var(--clay)" }} disabled={busy} onClick={() => void run({ action: "revoke_access" }, "Access revoked.")}>Revoke access</button>
                <button className="btn btn-quiet" onClick={() => setConfirmRevoke(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-quiet self-start" style={{ color: "var(--clay)" }} onClick={() => setConfirmRevoke(true)}>Revoke access…</button>
          )
        )}
        {row.participation === "revoked" && (
          <button className="btn btn-quiet self-start" disabled={busy} onClick={() => void run({ action: "restore_access" }, "Access restored.")}>Restore access</button>
        )}

        <p className="label mt-3">Password</p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {row.hasLogin ? "Sets a new temporary password. Their old one stops working." : "They have no login yet. This creates one."}
        </p>
        <button className="btn btn-quiet self-start" disabled={busy} onClick={() => void run({ action: "reset_password" }, "")}>
          {row.hasLogin ? "Reset password" : "Create login"}
        </button>
        {password && <PasswordNotice password={password} email={row.email} />}

        {row.role === "student" && (
          <>
            <label className="label mt-3" htmlFor={`by-${row.id}`}>Birth year</label>
            <div className="flex gap-2">
              <input id={`by-${row.id}`} type="number" min={1900} max={2100} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} className="w-28 rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
              <button className="btn btn-quiet" disabled={busy} onClick={() => void run({ action: "set_birth_year", birthYear: birthYear ? Number(birthYear) : null }, "Birth year saved.")}>Save</button>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <p className="label">Releases</p>
        <p className="text-sm">
          Their own: <strong>{RELEASE_LABEL[row.own]}</strong>
          {row.own !== "valid" && row.own !== "revoked" && " (they sign it in the app the next time they sign in)"}
        </p>

        {row.parentalNeeded && (
          <>
            <p className="text-sm">
              Parent or guardian: <strong>{RELEASE_LABEL[row.parental ?? "missing"]}</strong>
            </p>
            {row.parental !== "valid" && (
              <form
                className="flex flex-col gap-2 rounded-sm border p-3"
                style={{ borderColor: "var(--rule)" }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    { action: "record_parental", signedBy: guardian, signedOn, expiresOn: expiresOn || null },
                    "Parent release recorded. Anything held for it can now be posted.",
                  );
                }}
              >
                <p className="text-sm font-semibold">Record the signed paper form</p>
                <label className="label" htmlFor={`g-${row.id}`}>Signed by (parent or guardian)</label>
                <input id={`g-${row.id}`} required minLength={2} value={guardian} onChange={(e) => setGuardian(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="label">Date signed</span>
                    <input type="date" required max={today} value={signedOn} onChange={(e) => setSignedOn(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label">Expires (optional)</span>
                    <input type="date" min={signedOn} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
                  </label>
                </div>
                <button className="btn self-start" disabled={busy || guardian.trim().length < 2}>Record parent release</button>
              </form>
            )}
          </>
        )}

        {(row.own === "valid" || row.parental === "valid") && (
          withdrawing ? (
            <form
              className="flex flex-col gap-2 rounded-sm border p-3"
              style={{ borderColor: "var(--clay)" }}
              onSubmit={(event) => {
                event.preventDefault();
                void run({ action: "withdraw_release", type: withdrawing, reason: withdrawReason }, "Release withdrawn.");
              }}
            >
              <p className="text-sm font-semibold" style={{ color: "var(--clay)" }}>
                Withdraw the {withdrawing === "parental" ? "parent" : "student"} release
              </p>
              <p className="text-sm">
                {row.postedCount > 0
                  ? `${row.postedCount} posted item${row.postedCount === 1 ? "" : "s"} they're in will move back to Ready to post and can't be posted again. Remove ${row.postedCount === 1 ? "it" : "them"} from the social platforms yourself.`
                  : "Nothing they're in has been posted. Anything new they're in will be held."}
              </p>
              <label className="label" htmlFor={`wr-${row.id}`}>Reason (kept in the record)</label>
              <input id={`wr-${row.id}`} required minLength={3} value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} placeholder="Parent emailed the office on 9/24" />
              <div className="flex gap-2">
                <button className="btn" style={{ background: "var(--clay)", borderColor: "var(--clay)" }} disabled={busy || withdrawReason.trim().length < 3}>Withdraw release</button>
                <button type="button" className="btn btn-quiet" onClick={() => setWithdrawing(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              {row.own === "valid" && (
                <button className="btn btn-quiet" style={{ color: "var(--clay)" }} onClick={() => setWithdrawing("media_release")}>Withdraw their release…</button>
              )}
              {row.parental === "valid" && (
                <button className="btn btn-quiet" style={{ color: "var(--clay)" }} onClick={() => setWithdrawing("parental")}>Withdraw parent release…</button>
              )}
            </div>
          )
        )}
      </section>

      {(error || done) && (
        <p className="text-sm md:col-span-2" style={{ color: error ? "var(--clay)" : "var(--moss)" }} role={error ? "alert" : "status"}>
          {error || done}
        </p>
      )}
    </div>
  );
}
