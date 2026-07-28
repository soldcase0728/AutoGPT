import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdmin } from "@/lib/auth/rbac";
import { storage } from "@/integrations/storage";

/**
 * Stream a stored document. Permission is re-checked here rather than relying
 * on the storage key being unguessable: signed agreements and certificates of
 * insurance are exactly the files that must not leak.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { booking: true },
  });

  if (!document || !document.fileUrl) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const owns =
    document.userId === user.id ||
    document.booking?.requesterId === user.id ||
    (document.organizationId !== null && document.organizationId === user.organizationId);

  if (!owns && !isAdmin(user.role) && user.role !== "FINANCE") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const bytes = await storage().get(document.fileUrl);
  if (!bytes) return NextResponse.json({ error: "File is missing from storage." }, { status: 404 });

  const metadata = (document.metadata ?? {}) as { filename?: string; contentType?: string };

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": metadata.contentType ?? "application/pdf",
      "content-disposition": `attachment; filename="${metadata.filename ?? `${document.type.toLowerCase()}.pdf`}"`,
      "cache-control": "private, no-store",
    },
  });
}
