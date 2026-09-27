"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small square preview of a submission. Loads only once it scrolls into view,
 * so a long list does not open a signed URL for every item at once. Falls back
 * to a labelled tile when there is nothing to show (not uploaded, or removed).
 */
export function Thumbnail({
  src,
  kind,
  label,
}: {
  src: string | null;
  kind: "photo" | "video";
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !src) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [src]);

  const showMedia = src && visible && !failed;

  return (
    <div
      ref={boxRef}
      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--rule)", background: "var(--sunk)" }}
    >
      {showMedia && kind === "video" && (
        <video
          // #t nudges mobile Safari into painting the first frame.
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-label={label}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
      {showMedia && kind === "photo" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={label}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
      {(!src || failed) && (
        <span
          className="absolute inset-0 flex items-center justify-center p-1 text-center font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ color: "var(--muted)" }}
        >
          {src ? "No preview" : "Not shot yet"}
        </span>
      )}
      {showMedia && kind === "video" && (
        <span
          aria-hidden
          className="absolute bottom-1 right-1 rounded-sm px-1 font-mono text-[9px] uppercase"
          style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}
        >
          Video
        </span>
      )}
    </div>
  );
}
