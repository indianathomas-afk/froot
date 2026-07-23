import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { detectAndStoreVersionAnchors } from "@/lib/hr-anchors"
import { HrFileValidationError, readHrFileMeta, validateHrFileMeta } from "@/lib/hr-files"
import { isOrgHrBlobUrl, requireHrDocumentAccess } from "../../access"

const bodySchema = z.object({
  url: z.string().url(),
  fileName: z.string().trim().min(1),
})

// POST /api/hr/documents/[id]/versions — ADMIN. Re-upload: registers a new
// HrDocumentVersion as current and demotes the prior one. The old version row
// (and its file, hash, acknowledgments, and signed records) is never touched —
// staff who signed it now read as "needs current version". Checkpoints are
// document-scoped, so they carry forward to the new version automatically.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "An uploaded file is required" }, { status: 400 })
  }
  const { url, fileName } = parsed.data

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  })
  if (!doc || doc.versions.length === 0) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }

  if (!isOrgHrBlobUrl(url, org.id)) {
    return NextResponse.json({ error: "Invalid file reference" }, { status: 400 })
  }

  const isAcknowledgment = doc.kind === "Acknowledgment"
  let meta
  try {
    meta = await readHrFileMeta(url, { includeBytes: isAcknowledgment })
    validateHrFileMeta(meta.contentType, meta.sizeBytes)
  } catch (err) {
    if (err instanceof HrFileValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: "Uploaded file not found — try the upload again" },
      { status: 400 }
    )
  }

  if (isAcknowledgment && meta.contentType !== "application/pdf") {
    return NextResponse.json({ error: "Signature documents must be PDFs" }, { status: 400 })
  }

  const [, version] = await prisma.$transaction([
    prisma.hrDocumentVersion.updateMany({
      where: { hrDocumentId: doc.id, isCurrent: true },
      data: { isCurrent: false },
    }),
    prisma.hrDocumentVersion.create({
      data: {
        hrDocumentId: doc.id,
        versionNumber: doc.versions[0].versionNumber + 1,
        fileUrl: meta.url,
        fileName,
        contentType: meta.contentType,
        sizeBytes: meta.sizeBytes,
        fileHash: meta.fileHash,
        isCurrent: true,
        uploadedByUserId: dbUser.id,
      },
    }),
  ])

  // HR-11b: anchors are per-version — a new file needs a fresh scan (ruling #1,
  // re-detect + re-confirm on every version). Checkpoints still carry forward
  // (document-level); the admin re-confirms the new version's anchors before
  // stamping uses them. Best effort — image-only / scan failure → zero anchors.
  if (isAcknowledgment && meta.bytes) {
    await detectAndStoreVersionAnchors(version.id, new Uint8Array(meta.bytes))
  }

  return NextResponse.json(version, { status: 201 })
}
