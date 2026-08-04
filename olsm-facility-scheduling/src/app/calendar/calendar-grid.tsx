"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  formatMinutes,
  layoutColumn,
  snapMinutes,
  type TimeSpan,
} from "@/domain/calendar-layout";

export interface GridEvent extends TimeSpan {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  activityType: string;
  /** Which column this belongs to: a date (week view) or a sub-space (day view). */
  columnKey: string;
  href: string;
  /** True for holds that are not yet confirmed; drawn hatched. */
  provisional: boolean;
  /** Fill and ink for this event's sport, or the non-team slate. */
  fill: string;
  ink: string;
}

export interface GridColumn {
  key: string;
  label: string;
  sublabel?: string;
  /** Present in day view; lets drag-to-create prefill the space. */
  subSpaceId?: string;
  /** Present in week view; lets drag-to-create prefill the date. */
  dateISO?: string;
}

interface Selection {
  columnKey: string;
  startMinutes: number;
  endMinutes: number;
}

/**
 * Time grid. Columns are days (week view) or sub-spaces (day view) -- the
 * second is what an athletic director actually needs to answer "what is in
 * Dombrowski on Tuesday", because a single day column stacked with eight
 * bookings across five spaces is unreadable.
 *
 * Drag on empty space to create. The drag only ever produces a prefilled link
 * to the booking form; it never writes anything, so the conflict, compliance
 * and pricing checks all still run server-side exactly as they would from a
 * typed request.
 */
export function CalendarGrid({
  columns,
  events,
  startMinutes,
  endMinutes,
  canCreate,
  dateISO,
}: {
  columns: GridColumn[];
  events: GridEvent[];
  startMinutes: number;
  endMinutes: number;
  canCreate: boolean;
  dateISO: string;
}) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const draggingRef = useRef(false);
  // State drives the preview; the ref is what pointerup reads, so a fast drag
  // that releases before React re-renders still produces the right range.
  const selectionRef = useRef<Selection | null>(null);

  const updateSelection = useCallback((next: Selection | null) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const span = endMinutes - startMinutes;
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = startMinutes; m <= endMinutes; m += 60) out.push(m);
    return out;
  }, [startMinutes, endMinutes]);

  const laidOut = useMemo(
    () =>
      columns.map((column) => ({
        column,
        items: layoutColumn(
          events.filter((e) => e.columnKey === column.key),
          startMinutes,
          endMinutes,
        ),
      })),
    [columns, events, startMinutes, endMinutes],
  );

  const minutesFromPointer = useCallback(
    (clientY: number, element: HTMLElement): number => {
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
      return snapMinutes(startMinutes + ratio * span);
    },
    [startMinutes, span],
  );

  const onPointerDown = (columnKey: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canCreate) return;
    // Ignore drags that begin on an existing booking.
    if ((e.target as HTMLElement).closest("[data-event]")) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const minutes = minutesFromPointer(e.clientY, e.currentTarget);
    updateSelection({ columnKey, startMinutes: minutes, endMinutes: minutes + 30 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = selectionRef.current;
    if (!draggingRef.current || !current) return;
    const minutes = minutesFromPointer(e.clientY, e.currentTarget);
    updateSelection({
      ...current,
      endMinutes: Math.max(minutes, current.startMinutes + 15),
    });
  };

  const onPointerUp = () => {
    const current = selectionRef.current;
    if (!draggingRef.current || !current) return;
    draggingRef.current = false;

    const column = columns.find((c) => c.key === current.columnKey);
    const params = new URLSearchParams({
      date: column?.dateISO ?? dateISO,
      start: formatMinutes(current.startMinutes),
      end: formatMinutes(current.endMinutes),
    });
    if (column?.subSpaceId) params.set("subSpace", column.subSpaceId);

    updateSelection(null);
    router.push(`/book?${params.toString()}`);
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        {/* Column headers */}
        <div
          className="grid border-b border-navy-200"
          style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          <div />
          {columns.map((column) => (
            <div key={column.key} className="px-2 py-2 text-center">
              <p className="text-sm font-semibold text-navy-900">{column.label}</p>
              {column.sublabel && (
                <p className="text-xs text-navy-600">{column.sublabel}</p>
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          className="relative grid"
          style={{
            gridTemplateColumns: `4rem repeat(${columns.length}, minmax(0, 1fr))`,
            height: `${Math.max(span / 60, 4) * 3.5}rem`,
          }}
        >
          {/* Hour gutter */}
          <div className="relative border-r border-navy-200">
            {hours.map((m) => (
              <div
                key={m}
                className="absolute -translate-y-1/2 pr-2 text-right text-xs text-navy-500"
                style={{ top: `${((m - startMinutes) / span) * 100}%`, width: "100%" }}
              >
                {formatMinutes(m)}
              </div>
            ))}
          </div>

          {laidOut.map(({ column, items }) => (
            <div
              key={column.key}
              className={clsx(
                "relative border-r border-navy-100",
                canCreate && "cursor-crosshair",
              )}
              onPointerDown={onPointerDown(column.key)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                draggingRef.current = false;
                updateSelection(null);
              }}
              // Without this a touch drag scrolls the page instead of selecting.
              style={{ touchAction: canCreate ? "none" : undefined }}
            >
              {/* Hour lines */}
              {hours.map((m) => (
                <div
                  key={m}
                  aria-hidden
                  className="absolute w-full border-t border-navy-100"
                  style={{ top: `${((m - startMinutes) / span) * 100}%` }}
                />
              ))}

              {/* Drag preview */}
              {selection?.columnKey === column.key && (
                <div
                  aria-hidden
                  className="absolute inset-x-1 rounded border-2 border-dashed border-gold-600 bg-gold-100/70"
                  style={{
                    top: `${((selection.startMinutes - startMinutes) / span) * 100}%`,
                    height: `${((selection.endMinutes - selection.startMinutes) / span) * 100}%`,
                  }}
                >
                  <span className="block px-1 py-0.5 text-[10px] font-medium text-gold-950">
                    {formatMinutes(selection.startMinutes)}–{formatMinutes(selection.endMinutes)}
                  </span>
                </div>
              )}

              {items.map(({ event, top, height, left, width }) => (
                <a
                  key={event.id}
                  data-event
                  href={event.href}
                  title={`${event.title} — ${event.subtitle} (${event.status})`}
                  className={clsx(
                    "absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight shadow-sm",
                    // A held slot is drawn lighter and ringed. Opacity alone
                    // would read as "further away" rather than "not yours yet",
                    // so the word "held" is printed in the block as well.
                    event.provisional && "opacity-75 ring-2 ring-inset ring-white/70",
                  )}
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    left: `calc(${left}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    backgroundColor: event.fill,
                    color: event.ink,
                  }}
                >
                  <span className="block truncate font-semibold">{event.title}</span>
                  <span className="block truncate opacity-90">{event.subtitle}</span>
                  {event.provisional && <span className="block truncate opacity-90">held</span>}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      {canCreate && (
        <p className="mt-2 text-xs text-navy-600">
          Drag across empty time to start a booking. Nothing is reserved until you submit the form.
        </p>
      )}
    </div>
  );
}
