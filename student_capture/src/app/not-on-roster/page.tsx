export default function NotOnRoster() {
  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-2xl font-bold tracking-tight">You are not on a roster yet</h1>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        You signed in, but this address is not on any programme roster. Ask whoever
        invited you to add it, then sign in again — nothing else is needed.
      </p>
    </main>
  );
}
