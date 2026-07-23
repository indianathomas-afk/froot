import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canReadHrDocument, getHrFileDownloadUrl, hrPathnameFromUrl, streamHrFile } from "@/lib/hr-files"
import { requireHrDocumentAccess } from "../../access"

// GET /api/hr/documents/[id]/download — authorized delivery for private HR
// blobs. Resolves the document's current version, applies the per-kind access
// policy, then redirects to a short-lived signed URL. The stored blob URL is
// never exposed and is not fetchable without a signature.
// HR-11: `?stream=1` proxies the bytes same-origin instead (Content-Type
// preserved, inline disposition) — the in-page pdf.js viewer reads this so
// rendering never depends on cross-origin fetch behavior of the blob host.
// Same authorization either way.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // FillableForm versions carry a definition snapshot, not a file — there is
  // nothing to download here (executed PDFs live on the submission route).
  if (doc.kind === "FillableForm" || !version.fileUrl) {
    return NextResponse.json({ error: "This document has no downloadable file" }, { status: 404 })
  }

  if (new URL(req.url).searchParams.get("stream") === "1") {
    const upstream = await streamHrFile(version.fileUrl)
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/pdf",
        "Content-Disposition": `inline; filename="${version.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    })
  }

  const signedUrl = await getHrFileDownloadUrl(hrPathnameFromUrl(version.fileUrl))
  return NextResponse.redirect(signedUrl, 307)
}
