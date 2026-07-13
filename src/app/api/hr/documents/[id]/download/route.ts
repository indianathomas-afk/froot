import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canReadHrDocument, getHrFileDownloadUrl, hrPathnameFromUrl } from "@/lib/hr-files"
import { requireHrDocumentAccess } from "../../access"

// GET /api/hr/documents/[id]/download — authorized delivery for private HR
// blobs. Resolves the document's current version, applies the per-kind access
// policy, then redirects to a short-lived signed URL. The stored blob URL is
// never exposed and is not fetchable without a signature.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess()
  if (!access.ok) return access.response
  const { org, dbUser } = access

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, isActive: true },
    include: { versions: { where: { isCurrent: true }, take: 1 } },
  })
  const version = doc?.versions[0]
  // Cross-org or unknown IDs 404 rather than 403 — don't leak existence.
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  if (!canReadHrDocument(doc, { orgDbId: org.id, role: dbUser?.role ?? null })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const signedUrl = await getHrFileDownloadUrl(hrPathnameFromUrl(version.fileUrl))
  return NextResponse.redirect(signedUrl, 307)
}
