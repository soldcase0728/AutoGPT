/**
 * Email and SMS delivery.
 *
 * Both default to a console transport so a development or test run never sends
 * a real message to a real coach. Nothing here decides *whether* to notify --
 * that is notification-service.ts; this is only transport.
 */

import { env } from "@/lib/env";
import { getGraphAccessToken, graphConfigured } from "@/lib/auth/entra";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface SmsMessage {
  to: string;
  body: string;
}

export interface DeliveryResult {
  delivered: boolean;
  provider: string;
  detail?: string;
}

export async function sendEmail(message: EmailMessage): Promise<DeliveryResult> {
  switch (env.email.provider) {
    case "graph":
      if (!graphConfigured()) break;
      return sendViaGraph(message);
    case "sendgrid":
      if (!env.email.sendgridKey) break;
      return sendViaSendgrid(message);
    case "postmark":
      if (!env.email.postmarkToken) break;
      return sendViaPostmark(message);
    default:
      break;
  }
  return consoleEmail(message);
}

/**
 * Microsoft Graph, sending as one designated mailbox.
 *
 * Application permissions with a client-credentials token, not Basic SMTP
 * authentication -- which Microsoft has disabled for Exchange Online anyway,
 * and which would mean storing a password for a real mailbox.
 *
 * The permission this needs is Mail.Send. Granted plainly it lets this
 * application send as anyone in the tenant, so it should be narrowed to the one
 * mailbox with an application access policy; DEPLOY.md has the command. The
 * mailbox is named in configuration rather than taken from the message, so a
 * bug elsewhere cannot address the request to a different sender.
 */
async function sendViaGraph(message: EmailMessage): Promise<DeliveryResult> {
  const token = await getGraphAccessToken();
  const mailbox = encodeURIComponent(env.graph.senderMailbox);

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: message.html
          ? { contentType: "HTML", content: message.html }
          : { contentType: "Text", content: message.text },
        toRecipients: [{ emailAddress: { address: message.to } }],
        ...(message.replyTo
          ? { replyTo: [{ emailAddress: { address: message.replyTo } }] }
          : {}),
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    // Graph error bodies quote the mailbox and the application id. Keep the
    // status, drop the rest.
    return {
      delivered: false,
      provider: "graph",
      detail: `Graph sendMail failed (${res.status}).`,
    };
  }

  return { delivered: true, provider: "graph" };
}

async function sendViaSendgrid(message: EmailMessage): Promise<DeliveryResult> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.email.sendgridKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: env.email.from, name: "OLSM Athletics" },
      reply_to: message.replyTo ? { email: message.replyTo } : undefined,
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        ...(message.html ? [{ type: "text/html", value: message.html }] : []),
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return { delivered: true, provider: "sendgrid" };
}

async function sendViaPostmark(message: EmailMessage): Promise<DeliveryResult> {
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": env.email.postmarkToken,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      From: env.email.from,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      ReplyTo: message.replyTo,
      MessageStream: "outbound",
    }),
  });

  if (!res.ok) {
    throw new Error(`Postmark ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return { delivered: true, provider: "postmark" };
}

function consoleEmail(message: EmailMessage): DeliveryResult {
  if (process.env.NODE_ENV !== "test") {
    console.info(
      `[email:console] to=${message.to} subject=${message.subject}\n${message.text}\n`,
    );
  }
  return { delivered: true, provider: "console", detail: "Not actually sent." };
}

export async function sendSms(message: SmsMessage): Promise<DeliveryResult> {
  if (env.sms.provider === "twilio" && env.sms.accountSid && env.sms.authToken) {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.sms.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${env.sms.accountSid}:${env.sms.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: message.to,
          From: env.sms.from,
          Body: message.body,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return { delivered: true, provider: "twilio" };
  }

  if (process.env.NODE_ENV !== "test") {
    console.info(`[sms:console] to=${message.to} body=${message.body}`);
  }
  return { delivered: true, provider: "console", detail: "Not actually sent." };
}
