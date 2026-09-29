import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getHrFileDownloadUrl, hrPathnameFromUrl, streamHrFile } from "@/lib/hr-files"
import { hrPreviewType } from "@/lib/hr-documents"
import {
  AUDIENCE_INCLUDE,
  canReadHrDocument,
  resolveDocumentViewer,
} from "@/lib/hr-documents-access"
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
    include: { versions: { where: { isCurrent: true }, take: 1 }, ...AUDIENCE_INCLUDE },
  })
  const version = doc?.versions[0]
  // Cross-org or unknown IDs 404 rather than 403 — don't leak existence.
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  // DOC-1 A: the policy is now audience-aware. This route is the ONE call site
  // that had it before the phase, and it keeps 403 rather than 404 for a
  // refusal — the id is real and the caller may well have been shown it by a
  // stale page, so "forbidden" is the honest answer and leaks nothing a list
  // surface did not already give away.
  const viewer = await resolveDocumentViewer(org.id, dbUser)
  if (!canReadHrDocument(doc, viewer)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // FillableForm versions carry a definition snapshot, not a file — there is
  // nothing to download here (executed PDFs live on the submission route).
  if (doc.kind === "FillableForm" || !version.fileUrl) {
    return NextResponse.json({ error: "This document has no downloadable file" }, { status: 404 })
  }

  // DOC-11: `?disposition=inline` feeds the Document Library's Preview dialog.
  // It sits BELOW the permission check above and adds none of its own — this
  // is the same route, the same refusals (404 unknown, 403 not-your-audience).
  // Unlike ?stream=1 it serves only previewable types (hrPreviewType: PDF and
  // images, 415 for the rest) with OUR Content-Type rather than the blob's.
  // Previewing records nothing (DOC-11 ruling 5) — nor does download today;
  // keep it that way if download ever gains an audit write.
  const searchParams = new URL(req.url).searchParams
  if (searchParams.get("disposition") === "inline") {
    const preview = hrPreviewType(version.contentType, version.fileName)
    if (!preview) {
      return NextResponse.json({ error: "Preview not available for this file type" }, { status: 415 })
    }
    const upstream = await streamHrFile(version.fileUrl)
    return new Response(upstream.body, {
      headers: {
        "Content-Type": preview.mime,
        "Content-Disposition": `inline; filename="${version.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }

  if (searchParams.get("stream") === "1") {
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
