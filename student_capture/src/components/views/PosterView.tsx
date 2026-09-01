/**
 * A printable poster for a locker room wall. Everything is sized for paper and
 * forced to a light palette — a poster printed from a dark-mode screen wastes
 * a toner cartridge and reads badly.
 */
export function PosterView({
  orgName,
  headline,
  url,
  qrSvg,
}: {
  orgName: string;
  headline: string;
  url: string;
  /** Pre-rendered QR as an SVG string. */
  qrSvg: string;
}) {
  return (
    <>
      <style>{`
        @page { size: portrait; margin: 12mm; }
        .poster {
          background: #ffffff;
          color: #17191a;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 28px;
          padding: 48px 44px;
          max-width: 780px;
          margin: 0 auto;
          text-align: center;
        }
        .poster svg { width: 100%; height: auto; display: block; }
        @media print {
          .poster { min-height: auto; padding: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="poster">
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#8a6600",
            margin: 0,
          }}
        >
          {orgName}
        </p>

        <h1
          style={{
            fontSize: "clamp(38px, 8vw, 68px)",
            lineHeight: 0.98,
            letterSpacing: "-0.035em",
            fontWeight: 800,
            margin: 0,
            textWrap: "balance",
          }}
        >
          {headline}
        </h1>

        <div
          style={{
            border: "2px solid #17191a",
            padding: 20,
            width: "min(340px, 70vw)",
            margin: "0 auto",
          }}
          // The QR is generated server-side by the `qrcode` package from the
          // URL below; there is no user input in this string.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>
            Point your camera at this.
          </p>
          <p style={{ fontSize: 16, color: "#63665f", margin: 0, lineHeight: 1.5 }}>
            Sign in with your school email — no password. You get one prompt a
            morning, it takes under a minute, and you can stop any time.
          </p>
        </div>

        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "#63665f",
            wordBreak: "break-all",
            margin: 0,
          }}
        >
          {url}
        </p>
      </div>
    </>
  );
}
