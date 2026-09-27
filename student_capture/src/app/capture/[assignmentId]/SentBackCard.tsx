import { Thumbnail } from "@/components/Thumbnail";
import type { SentBack } from "./CaptureFlow";

/**
 * Top of a reshoot: what the desk wants changed, in their words, and the take
 * they returned, shown small and marked so nobody mistakes it for sendable.
 */
export function SentBackCard({ sentBack }: { sentBack: SentBack }) {
  const previousSrc = sentBack.previous
    ? `/api/captures/${sentBack.previous.captureId}/media?mediaId=${sentBack.previous.mediaId}`
    : null;
  return (
    <section className="card p-5" style={{ borderColor: "var(--accent)", borderWidth: 2 }} aria-label="Sent back">
      <span
        className="inline-block rounded-sm border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
      >
        Sent back
      </span>
      <p className="mt-3 text-[17px] font-semibold leading-snug">
        {sentBack.note ?? "The marketing desk asked for a new take."}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>From the marketing desk. Shoot it again with this fixed.</p>
      {previousSrc && (
        <div className="mt-4 flex items-center gap-3">
          <div className="opacity-60">
            <Thumbnail src={previousSrc} kind={sentBack.previous!.kind} label="The take that was sent back" />
          </div>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            The take you sent before. This one won&rsquo;t be sent again.
          </p>
        </div>
      )}
    </section>
  );
}
