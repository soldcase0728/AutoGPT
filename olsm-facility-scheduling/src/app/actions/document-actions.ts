"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin, requireUser } from "@/lib/auth/current-user";
import { errorMessage } from "@/lib/errors";
import {
  issueAnnualAgreement,
  recordSignature,
  sendDocument,
  uploadCertificateOfInsurance,
} from "@/services/document-service";
import { startCheckout } from "@/services/invoice-service";
import { prisma } from "@/lib/db";
import type { Actor } from "@/services/booking-service";
import { redirect } from "next/navigation";

export interface DocumentFormState {
  error?: string;
  notice?: string;
}

async function actorFromSession(): Promise<Actor> {
  const user = await requireUser();
  const h = await headers();
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

export async function requestAnnualAgreementAction(): Promise<void> {
  const actor = await actorFromSession();
  await issueAnnualAgreement(actor.id, actor);
  revalidatePath("/my-documents");
}

export async function sendDocumentAction(formData: FormData): Promise<void> {
  const actor = await actorFromSession();
  await sendDocument(String(formData.get("documentId") ?? ""), actor);
  revalidatePath("/my-documents");
  revalidatePath("/portal");
}

/** In-app signature, used when ESIGN_PROVIDER is "manual". */
export async function signDocumentAction(
  _prev: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const documentId = String(formData.get("documentId") ?? "");
  const typedName = String(formData.get("typedName") ?? "").trim();
  const agreed = formData.get("agree") === "on";

  if (!agreed) return { error: "You must accept the terms to sign." };
  if (typedName.length < 3) return { error: "Type your full name to sign." };

  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return { error: "That document could not be found." };

  const h = await headers();
  try {
    await recordSignature(documentId, {
      name: typedName,
      email: document.signerEmail ?? "",
      ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }

  revalidatePath("/my-documents");
  revalidatePath("/portal");
  return { notice: "Signed. Thank you." };
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export async function uploadCoiAction(
  _prev: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const actor = await actorFromSession();
  const file = formData.get("file");
  const expiresAtRaw = String(formData.get("expiresAt") ?? "");
  const documentId = String(formData.get("documentId") ?? "") || undefined;
  const bookingId = String(formData.get("bookingId") ?? "") || undefined;

  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is larger than 10 MB." };
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: "Upload a PDF, PNG or JPEG." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw)) {
    return { error: "Enter the certificate's expiry date." };
  }

  try {
    await uploadCertificateOfInsurance({
      documentId,
      bookingId,
      file: new Uint8Array(await file.arrayBuffer()),
      filename: file.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
      contentType: file.type,
      expiresAt: new Date(`${expiresAtRaw}T23:59:59Z`),
      actor,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }

  revalidatePath("/portal");
  return { notice: "Certificate uploaded." };
}

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const actor = await actorFromSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const handoff = await startCheckout(invoiceId, actor);
  redirect(handoff.url);
}

/** Offline payment (cash, cheque, internal transfer) recorded by an admin. */
export async function recordOfflinePaymentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const actor = await actorFromSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const method = String(formData.get("method") ?? "offline");

  const { markInvoicePaid } = await import("@/services/invoice-service");
  const { advanceBooking } = await import("@/services/booking-service");
  const invoice = await markInvoicePaid(invoiceId, actor, { method });
  await advanceBooking(invoice.bookingId, actor);

  revalidatePath("/portal");
  revalidatePath("/admin/reports");
}
