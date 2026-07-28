import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OLSM Facility Scheduling",
    template: "%s · OLSM Facility Scheduling",
  },
  description:
    "Reserve Orchard Lake St. Mary's Preparatory athletic facilities. One schedule for coaches, " +
    "athletic office staff, facilities staff and outside groups.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d3557",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
