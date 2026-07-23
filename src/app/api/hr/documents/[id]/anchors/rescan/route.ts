import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { detectAndStoreVersionAnchors } from "@/lib/hr-anchors"
import { streamHrFile } from "@/lib/hr-files"
import { requireHrDocumentAccess } from "../../../access"

// POST /api/hr/documents/[id]/anchors/rescan — ADMIN. Re-run field detection
// against the CURRENT version's already-uploaded file, without a re-upload.
// Two uses: (1) documents that predate HR-11b (or were image-only at upload)
// have no anchors until scanned; (2) re-detect after detection improves.
// Replaces the version's UNCONFIRMED anchor set only — confirmed anchors are
// preserved (ruling #5). The admin then confirms as usual.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: access.org.id, kind: "Acknowledgment" },
    include: { versions: { where: { isCurrent: true }, take: 1 } },
  })
  const version = doc?.versions[0]
  if (!doc || !version) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }
  if (version.contentType !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF documents can be scanned for fields" }, { status: 400 })
  }

  let bytes: Buffer
  try {
    const res = await streamHrFile(version.fileUrl)
    bytes = Buffer.from(await res.arrayBuffer())
  } catch {
    return NextResponse.json({ error: "Could not read the document file" }, { status: 400 })
  }

  const detected = await detectAndStoreVersionAnchors(version.id, new Uint8Array(bytes))
  return NextResponse.json({ detected }, { status: 200 })
}
