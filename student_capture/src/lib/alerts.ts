import "server-only";

/**
 * Safety reports have to reach a human quickly, so they go out on a webhook
 * (Slack and Teams incoming webhooks both accept a bare `text` field) as well
 * as landing in `safety_flags` and the audit trail.
 *
 * The webhook is best-effort by design: a report must never fail because the
 * chat tool is down. The database row is the durable record.
 */
export async function alertSafety(message: string): Promise<"sent" | "unconfigured" | "failed"> {
  const url = process.env.SAFETY_ALERT_WEBHOOK_URL;
  if (!url) return "unconfigured";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`[safety] webhook responded ${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (cause) {
    console.error("[safety] webhook failed", cause);
    return "failed";
  }
}

export function safetyMessage(input: {
  org: string;
  kind: string;
  detail: string;
  reporter: string;
  captureId?: string | null;
  appUrl?: string;
}): string {
  const where = input.captureId
    ? `${input.appUrl ?? ""}/review?capture=${input.captureId}`
    : "no capture attached";
  return [
    `:rotating_light: SAFETY REPORT — ${input.org}`,
    `Kind: ${input.kind}`,
    `Reported by: ${input.reporter}`,
    `Detail: ${input.detail}`,
    `Where: ${where}`,
  ].join("\n");
}
