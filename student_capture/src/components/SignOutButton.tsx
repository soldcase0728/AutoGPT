/** A plain form, so signing out works even before any JavaScript has loaded. */
export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post" className={className}>
      <button type="submit" className="text-sm underline underline-offset-4" style={{ color: "var(--muted)" }}>
        Sign out
      </button>
    </form>
  );
}
