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

  // Not fatal: a pilot runs perfectly well with mail going to the log, and
  // adding people still works because the invitation link is shown on screen
  // for the administrator to pass on. Worth saying loudly all the same, and
  // worth saying accurately -- this warning used to claim it disabled public
  // requests, which nothing in the code actually did.
  if (env.isProduction && !emailIsDeliverable()) {
    console.warn(
      [
        "WARNING: no real email provider is configured.",
        `  EMAIL_PROVIDER=${env.email.provider}, so mail is written to this log and nobody receives it.`,
        "  Nothing reaches a coach or a renter: no invitations, no approval notices,",
        "  no document reminders, no invoices. Admin > People still works -- it shows",
        "  you each sign-in link to pass on by hand -- but everything else is silent.",
        "  Set EMAIL_PROVIDER to graph, sendgrid or postmark, with matching credentials.",
      ].join("\n"),
    );
  }
}
