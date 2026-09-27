/** A plain form, so signing out works even before any JavaScript has loaded. */
export function SignOutButton({
  className = "",
  variant = "button",
}: {
  className?: string;
  /** "button" for the header's corner; "link" where it sits in running text. */
  variant?: "button" | "link";
}) {
  return (
    <form action="/auth/signout" method="post" className={className}>
      {variant === "button" ? (
        <button
          type="submit"
          className="rounded-sm border px-3 py-1.5 text-sm font-semibold"
          style={{ borderColor: "var(--ink)", color: "var(--ink)", fontSize: "14px" }}
        >
          Sign out
        </button>
      ) : (
        <button type="submit" className="text-sm underline underline-offset-4" style={{ color: "var(--muted)" }}>
          Sign out
        </button>
      )}
    </form>
  );
}
