/**
 * Storage keys are `<person_id>/<capture_id>/<filename>`. The first segment is
 * what the storage RLS policy checks, so it must be the owner and nothing else.
 */
export function captureObjectName(
  personId: string,
  captureId: string,
  originalFilename: string,
): string {
  return `${personId}/${captureId}/${safeFilename(originalFilename)}`;
}

/**
 * Phone filenames arrive with spaces, unicode, and occasionally path
 * separators. Reduce to something a URL and an object store both tolerate,
 * keeping the extension so players can sniff the type.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "capture";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base) || "capture";
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";

  const cleanStem =
    stem
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "capture";
  const cleanExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8);

  return cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem;
}

export function ownerOf(objectName: string): string | null {
  const [owner] = objectName.split("/");
  return owner || null;
}
