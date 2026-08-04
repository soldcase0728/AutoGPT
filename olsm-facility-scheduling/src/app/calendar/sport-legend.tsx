import type { LegendEntry } from "@/domain/sport-colors";

/**
 * The key to the calendar's colours.
 *
 * Lists only what is on screen. A fixed list of every sport the school runs is
 * a lookup table nobody reads; a list of the four in this week is a key.
 *
 * It is also what makes colour safe to use at all. Two of the six hues sit
 * close enough for a reader with deuteranopia that hue alone would not separate
 * them -- naming each sport beside its swatch is the second signal, and the
 * blocks themselves carry their titles.
 */
export function SportLegend({ entries }: { entries: readonly LegendEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-navy-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-navy-900">What the colours mean</h2>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: entry.color.fill }}
            />
            <span className="text-sm text-navy-800">{entry.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-navy-600">
        Only the sports booked in this view are listed. Every booking also shows its own name, so
        the colour is a shortcut rather than the only way to tell them apart.
      </p>
    </div>
  );
}
