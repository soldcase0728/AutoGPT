/**
 * E-signature provider abstraction.
 *
 * DocuSign and Dropbox Sign both model "send a templated envelope to a signer,
 * get a webhook when it completes, fetch the executed PDF". The rest of the
 * system only needs that shape, so it is expressed as one interface and the
 * provider is chosen by ESIGN_PROVIDER.
 *
 * The `manual` provider keeps the full document state machine but records an
 * in-app signature. It is what runs before OLSM picks a vendor, and it is what
 * makes the document flow testable without a sandbox account.
 */

import { DocumentType } from "@prisma/client";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/auth/password";

export interface SignerInfo {
  name: string;
  email: string;
}

/** Merge fields pushed into the template. */
export interface EnvelopeFields {
  requesterName: string;
  organizationName?: string;
  facilityName: string;
  subSpaceName: string;
  startAt: string;
  endAt: string;
  activityType: string;
  feeFormatted: string;
  insuranceRequirement?: string;
  bookingReference: string;
}

export interface SendEnvelopeInput {
  documentType: DocumentType;
  signer: SignerInfo;
  fields: EnvelopeFields;
  /** Correlates the webhook back to our Document row. */
  documentId: string;
  returnUrl: string;
}

export interface SentEnvelope {
  envelopeId: string;
  provider: string;
  /** Present when the signer can sign immediately in an embedded session. */
  signingUrl?: string;
}

export interface EsignProvider {
  readonly name: string;
  readonly configured: boolean;
  send(input: SendEnvelopeInput): Promise<SentEnvelope>;
  /** Executed PDF, fetched on completion and stored immutably. */
  fetchDocument(envelopeId: string): Promise<Uint8Array | null>;
  void(envelopeId: string, reason: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Manual (in-app signature)
// ---------------------------------------------------------------------------

const manualProvider: EsignProvider = {
  name: "manual",
  configured: true,

  async send(input) {
    // The signing URL is an in-app page keyed by an unguessable token; the
    // document row stores it as publicToken.
    const token = randomToken(24);
    return {
      envelopeId: `manual_${token}`,
      provider: "manual",
      signingUrl: `${env.appUrl}/sign/${token}`,
    };
  },

  async fetchDocument() {
    // The signed record is the Document row plus its audit trail.
    return null;
  },

  async void() {
    /* nothing to call */
  },
};

// ---------------------------------------------------------------------------
// DocuSign (JWT grant)
// ---------------------------------------------------------------------------

const TEMPLATE_HINTS: Record<DocumentType, string> = {
  ANNUAL_COACH_AGREEMENT: "OLSM Annual Coach Agreement",
  FACILITY_USE_AGREEMENT: "OLSM Facility Use Agreement",
  LIABILITY_WAIVER: "OLSM Liability Waiver and Release",
  CAMP_ADDENDUM: "OLSM Camp/Clinic Addendum",
  MINOR_PARTICIPANT_WAIVER: "OLSM Minor Participant Waiver",
  CERTIFICATE_OF_INSURANCE: "OLSM Certificate of Insurance",
};

class DocuSignProvider implements EsignProvider {
  readonly name = "docusign";

  get configured(): boolean {
    const d = env.esign.docusign;
    return Boolean(d.baseUri && d.accountId && d.integrationKey && d.userId && d.privateKey);
  }

  private async accessToken(): Promise<string> {
    const { SignJWT, importPKCS8 } = await import("jose");
    const d = env.esign.docusign;
    const key = await importPKCS8(d.privateKey, "RS256");
    const host = d.baseUri.includes("demo") ? "account-d.docusign.com" : "account.docusign.com";
    const now = Math.floor(Date.now() / 1000);

    const assertion = await new SignJWT({ scope: "signature impersonation" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(d.integrationKey)
      .setSubject(d.userId)
      .setAudience(host)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);

    const res = await fetch(`https://${host}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`DocuSign token request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }

  async send(input: SendEnvelopeInput): Promise<SentEnvelope> {
    const d = env.esign.docusign;
    const token = await this.accessToken();

    const res = await fetch(`${d.baseUri}/restapi/v2.1/accounts/${d.accountId}/envelopes`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        emailSubject: `${TEMPLATE_HINTS[input.documentType]} — ${input.fields.bookingReference}`,
        status: "sent",
        // The template is looked up by name in the OLSM DocuSign account; the
        // role name must be "Signer" in each template.
        templateRoles: [
          {
            email: input.signer.email,
            name: input.signer.name,
            roleName: "Signer",
            tabs: { textTabs: mergeTabs(input.fields) },
          },
        ],
        templateId: undefined,
        customFields: {
          textCustomFields: [
            { name: "olsmDocumentId", value: input.documentId, show: "false" },
          ],
        },
      }),
    });

    if (!res.ok) throw new Error(`DocuSign envelope failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { envelopeId: string };
    return { envelopeId: body.envelopeId, provider: this.name };
  }

  async fetchDocument(envelopeId: string): Promise<Uint8Array | null> {
    const d = env.esign.docusign;
    const token = await this.accessToken();
    const res = await fetch(
      `${d.baseUri}/restapi/v2.1/accounts/${d.accountId}/envelopes/${envelopeId}/documents/combined`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async void(envelopeId: string, reason: string): Promise<void> {
    const d = env.esign.docusign;
    const token = await this.accessToken();
    await fetch(`${d.baseUri}/restapi/v2.1/accounts/${d.accountId}/envelopes/${envelopeId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "voided", voidedReason: reason }),
    });
  }
}

// ---------------------------------------------------------------------------
// Dropbox Sign
// ---------------------------------------------------------------------------

class DropboxSignProvider implements EsignProvider {
  readonly name = "dropbox_sign";

  get configured(): boolean {
    return Boolean(env.esign.dropboxSign.apiKey);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${env.esign.dropboxSign.apiKey}:`).toString("base64")}`;
  }

  async send(input: SendEnvelopeInput): Promise<SentEnvelope> {
    const res = await fetch("https://api.hellosign.com/v3/signature_request/send", {
      method: "POST",
      headers: { authorization: this.authHeader(), "content-type": "application/json" },
      body: JSON.stringify({
        title: TEMPLATE_HINTS[input.documentType],
        subject: `${TEMPLATE_HINTS[input.documentType]} — ${input.fields.bookingReference}`,
        signers: [{ email_address: input.signer.email, name: input.signer.name }],
        metadata: { olsmDocumentId: input.documentId },
        custom_fields: Object.entries(input.fields).map(([name, value]) => ({
          name,
          value: String(value ?? ""),
        })),
      }),
    });

    if (!res.ok) throw new Error(`Dropbox Sign request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { signature_request: { signature_request_id: string } };
    return { envelopeId: body.signature_request.signature_request_id, provider: this.name };
  }

  async fetchDocument(envelopeId: string): Promise<Uint8Array | null> {
    const res = await fetch(`https://api.hellosign.com/v3/signature_request/files/${envelopeId}`, {
      headers: { authorization: this.authHeader() },
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async void(envelopeId: string, reason: string): Promise<void> {
    await fetch(`https://api.hellosign.com/v3/signature_request/cancel/${envelopeId}`, {
      method: "POST",
      headers: { authorization: this.authHeader(), "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  }
}

function mergeTabs(fields: EnvelopeFields) {
  return Object.entries(fields).map(([key, value]) => ({
    tabLabel: key,
    value: String(value ?? ""),
    locked: "true",
  }));
}

let cached: EsignProvider | null = null;

export function esignProvider(): EsignProvider {
  if (cached) return cached;
  switch (env.esign.provider) {
    case "docusign": {
      const p = new DocuSignProvider();
      cached = p.configured ? p : manualProvider;
      break;
    }
    case "dropbox_sign": {
      const p = new DropboxSignProvider();
      cached = p.configured ? p : manualProvider;
      break;
    }
    default:
      cached = manualProvider;
  }
  return cached;
}

/** Test seam. */
export function resetEsignProvider(): void {
  cached = null;
}

export { manualProvider };
