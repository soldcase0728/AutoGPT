/**
 * Who the app is dressed as. One school per deployment, so this is a constant
 * rather than a database lookup; the colour itself lives in globals.css as
 * --brand so dark mode can adjust it.
 */
export const BRAND = {
  schoolName: "Orchard Lake St. Mary's",
  shortName: "OLSM",
  appName: "OLSM Capture",
  logo: "/brand/olsm-logo.png",
  /** The red of the logo, for places CSS variables can't reach (manifest, meta). */
  red: "#E51837",
} as const;
