/**
 * The reasons a student (or anyone) can give when they report a prompt or a
 * clip. Worded for the student choosing one; the same labels show to staff.
 * Order is the dropdown's order: the physical-safety reason first.
 */
export const REPORT_KINDS = [
  { id: "unsafe_filming", label: "It isn't safe to film" },
  { id: "not_permitted", label: "A teacher or coach won't allow it" },
  { id: "protected_material", label: "Privacy: someone's face or private info" },
  { id: "prohibited_content", label: "It's against the honor code or the law" },
  { id: "other", label: "Something else" },
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number]["id"];

export function isReportKind(kind: unknown): kind is ReportKind {
  return REPORT_KINDS.some((k) => k.id === kind);
}

/** The label for a stored kind, or a readable fallback for one we don't know. */
export function reportKindLabel(kind: string): string {
  return REPORT_KINDS.find((k) => k.id === kind)?.label ?? kind.replaceAll("_", " ");
}
