/**
 * The fixture-rendered screens under /preview are a development tool. They are
 * also the only way to look at the app before a database exists, so a demo
 * deployment can opt them back in explicitly.
 *
 * Off unless someone sets DEMO_SCREENS=1. It must be set at BUILD time as well
 * as at run time: the preview routes are statically generated, so the guard is
 * evaluated when the pages are built.
 *
 * Safe to enable only because these screens render hard-coded fixtures. They
 * read nothing, and there is no real data for them to read.
 */
export function demoScreensEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.DEMO_SCREENS === "1";
}

export const PREVIEW_PREFIX = "/preview";
