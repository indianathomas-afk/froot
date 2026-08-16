import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  buildVersionScanReport,
  carryForwardConfirmedAnchors,
  detectAndStoreVersionAnchors,
  syncCheckpointsForConfirmedAnchors,
} from "@/lib/hr-anchors"
import { HrFileValidationError, readHrFileMeta, validateHrFileMeta } from "@/lib/hr-files"
import { isOrgHrBlobUrl, requireHrDocumentAccess } from "../../access"

// pdfjs anchor detection runs inline on new-version upload; needs Node + headroom.
export const runtime = "nodejs"
export const maxDuration = 60

const bodySchema = z.object({
  url: z.string().url(),
  fileName: z.string().trim().min(1),
})

// POST /api/hr/documents/[id]/versions — ADMIN. Re-upload: registers a new
// HrDocumentVersion as current and demotes the prior one. The old version row
// (and its file, hash, acknowledgments, and signed records) is never touched.
// Checkpoints are document-scoped, so they carry forward to the new version
// automatically.
//
// [SUPERSEDED 2026-08-15 BY R2] "— staff who signed it now read as 'needs
// current version'."
//
// R2 (HR-11k Phase A, Gary 2026-08-15): THEY DO NOT. Staff who signed the prior
// version in their current tenure keep their record, stay green, and are not
// re-prompted; a read-only notice tells them an update is available. This route
// is UNCHANGED BY R2 — the correction is to what the comment claimed about the
// downstream read, which the route never implemented and cannot control. The
// rule lives in documentCompletion (lib/hr-completion.ts).
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

  // HR-11d 2e: IDENTICAL BYTES CANNOT HAVE DIFFERENT COORDINATES. When the new
  // file's hash matches the version it replaces, the prior version's CONFIRMED
  // anchors carry forward as confirmed — arithmetic, not inference, so there is
  // no admin judgment left to exercise. Runs BEFORE detection so the
  // already-confirmed dedup inside detectAndStoreVersionAnchors sees them and
  // re-proposes nothing on top. Stamp coordinates only.
  //
  // [SUPERSEDED 2026-08-15 BY R2] "…: everyone still re-acknowledges the new
  // version (HR-11f untouched)." R2 SUPERSEDES HR-11f. Corrected in the same
  // commit as its twin at the top of this file, and deliberately: correcting one
  // false HR-11f assertion and leaving the other makes the survivor read as
  // current and authoritative, which is worse than correcting neither. The
  // carry-forward itself is unaffected — it is about ANCHOR COORDINATES, not
  // about who owes a signature.
  let carriedForward = 0
  if (isAcknowledgment && meta.fileHash === doc.versions[0].fileHash) {
    carriedForward = await carryForwardConfirmedAnchors(doc.versions[0].id, version.id)
    if (carriedForward > 0) {
      // Re-link each carried anchor to the checkpoint it drives. Checkpoints are
      // document-scoped, so this reuses the existing ones and creates nothing.
      await syncCheckpointsForConfirmedAnchors(doc.id, version.id)
    }
  }

  // HR-11b: anchors are per-version — a new file needs a fresh scan (ruling #1,
  // re-detect + re-confirm on every version). Checkpoints still carry forward
  // (document-level); the admin re-confirms the new version's anchors before
  // stamping uses them.
  //
  // HR-11d 2a: THE RESULT IS NO LONGER DISCARDED. It used to be called for its
  // side effect alone, and the `meta.bytes` falsy branch skipped detection with
  // no record at all — so an errored scan, an image-only PDF and a genuinely
  // field-less document were indistinguishable to the operator, all three
  // reading as "no fields". Same distinct-reporting rule as the rescan route
  // (R2 / DECISIONS HR-11b §k). Detection still never blocks the upload.
  const scanned =
    isAcknowledgment && meta.bytes
      ? await detectAndStoreVersionAnchors(version.id, new Uint8Array(meta.bytes))
      : null
  const scan = isAcknowledgment
    ? await buildVersionScanReport(version.id, scanned, carriedForward)
    : null

  return NextResponse.json({ ...version, scan }, { status: 201 })
}
