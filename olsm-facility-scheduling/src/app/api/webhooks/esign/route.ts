import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { recordSignature } from "@/services/document-service";

/**
 * E-signature completion webhook, for DocuSign and Dropbox Sign.
 *
 * Both providers post an envelope/signature-request id and a status; the shape
 * differs, so each is normalised to (envelopeId, completed) before the shared
 * handler runs.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();

  if (env.esign.webhookSecret) {
    const signature =
      request.headers.get("x-docusign-signature-1") ??
      request.headers.get("x-hellosign-signature") ??
      "";
    if (!verify(raw, signature, env.esign.webhookSecret)) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const normalised = normalise(body);
  if (!normalised) return NextResponse.json({ received: true, ignored: true });

  const document = await prisma.document.findFirst({
    where: { envelopeId: normalised.envelopeId },
  });
  if (!document) return NextResponse.json({ received: true, unknownEnvelope: true });

  if (normalised.completed) {
    // recordSignature is idempotent and re-advances the booking.
    await recordSignature(document.id, {
      name: normalised.signerName ?? document.signerName ?? "",
      email: normalised.signerEmail ?? document.signerEmail ?? "",
    });
  } else if (normalised.declined) {
    await prisma.document.update({ where: { id: document.id }, data: { status: "DECLINED" } });
  } else if (normalised.viewed && document.status === "SENT") {
    await prisma.document.update({ where: { id: document.id }, data: { status: "VIEWED" } });
  }

  return NextResponse.json({ received: true });
}

interface Normalised {
  envelopeId: string;
  completed: boolean;
  declined: boolean;
  viewed: boolean;
  signerName?: string;
  signerEmail?: string;
}

function normalise(body: Record<string, unknown>): Normalised | null {
  // DocuSign Connect
  const dsEnvelope = (body.data as Record<string, unknown> | undefined)?.envelopeId ?? body.envelopeId;
  if (dsEnvelope) {
    const status = String(body.event ?? body.status ?? "").toLowerCase();
    return {
      envelopeId: String(dsEnvelope),
      completed: status.includes("completed") || status.includes("signed"),
      declined: status.includes("declined") || status.includes("voided"),
      viewed: status.includes("viewed") || status.includes("delivered"),
    };
  }

  // Dropbox Sign
  const event = body.event as Record<string, unknown> | undefined;
  const signatureRequest = body.signature_request as Record<string, unknown> | undefined;
  if (signatureRequest?.signature_request_id) {
    const type = String(event?.event_type ?? "");
    const signers = (signatureRequest.signatures as Record<string, unknown>[] | undefined) ?? [];
    return {
      envelopeId: String(signatureRequest.signature_request_id),
      completed: type === "signature_request_all_signed" || signatureRequest.is_complete === true,
      declined: type === "signature_request_declined",
      viewed: type === "signature_request_viewed",
      signerName: signers[0]?.signer_name ? String(signers[0].signer_name) : undefined,
      signerEmail: signers[0]?.signer_email_address
        ? String(signers[0].signer_email_address)
        : undefined,
    };
  }

  return null;
}

function verify(payload: string, provided: string, secret: string): boolean {
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
