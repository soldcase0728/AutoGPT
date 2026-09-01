export function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "good" | "bad" | "accent";
}) {
  const color =
    tone === "good"
      ? "var(--moss)"
      : tone === "bad"
        ? "var(--clay)"
        : tone === "accent"
          ? "var(--accent)"
          : "var(--muted)";

  return (
    <span
      className="inline-block rounded-sm border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{ color, borderColor: color }}
    >
      {children}
    </span>
  );
}
