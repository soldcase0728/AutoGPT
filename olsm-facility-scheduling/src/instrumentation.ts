/**
 * Runs once when the server starts, before it accepts a request.
 *
 * Configuration is checked here rather than lazily at the first use, so a
 * misconfigured production instance fails visibly at deploy time instead of
 * quietly emailing links that point at localhost and passing its health check
 * while doing it.
 */
export async function register() {
  // Only the Node.js runtime; the edge runtime has no process env to speak of
  // and does not serve these routes.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionConfig, emailIsDeliverable, env } = await import("@/lib/env");

  assertProductionConfig();

  // Not fatal: an internal pilot runs perfectly well with mail going to the
  // log, and the public request path refuses to create a hold on its own when
  // it cannot send a verification link. Worth saying loudly all the same.
  if (env.isProduction && !emailIsDeliverable()) {
    console.warn(
      [
        "WARNING: no real email provider is configured.",
        `  EMAIL_PROVIDER=${env.email.provider}, so mail is written to this log and nobody receives it.`,
        "  Public facility requests are disabled while this is the case, because a",
        "  verification link that cannot be delivered cannot be completed.",
        "  Set EMAIL_PROVIDER to sendgrid or postmark, with the matching API key.",
      ].join("\n"),
    );
  }
}
