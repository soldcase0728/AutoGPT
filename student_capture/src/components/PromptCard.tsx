import { describeSpec } from "@/lib/format-spec";
import type { FormatSpec } from "@/lib/types";
import { Chip } from "./Chip";

export function PromptCard({
  title,
  brief,
  spec,
  campaign,
}: {
  title: string;
  brief: string;
  spec: FormatSpec;
  campaign?: string;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">{describeSpec(spec)}</Chip>
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
