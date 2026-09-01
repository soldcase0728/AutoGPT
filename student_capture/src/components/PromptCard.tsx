import type { PromptMediaType, PromptOrientation } from "@/lib/types";
import { Chip } from "./Chip";

export function PromptCard({
  title,
  brief,
  mediaType,
  orientation,
  minMediaCount,
  maxMediaCount,
  minDurationSeconds,
  maxDurationSeconds,
  campaign,
}: {
  title: string;
  brief: string;
  mediaType: PromptMediaType;
  orientation: PromptOrientation;
  minMediaCount: number;
  maxMediaCount: number;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  campaign?: string;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">
          {mediaType === "photo_series"
            ? `${minMediaCount}–${maxMediaCount} photos`
            : mediaType === "photo" ? "Photo" : "Video"}
          {orientation !== "any" ? ` · ${orientation}` : ""}
          {mediaType === "video" && minDurationSeconds && maxDurationSeconds
            ? ` · ${minDurationSeconds}–${maxDurationSeconds}s`
            : ""}
        </Chip>
        {campaign && <Chip>{campaign}</Chip>}
      </div>
      <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-balance">
        {title}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {brief}
      </p>
    </section>
  );
}
