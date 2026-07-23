import { NextResponse } from "next/server"
import { z } from "zod"
import { PDFDocument } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { detectAndStoreVersionAnchors } from "@/lib/hr-anchors"
import { HrFileValidationError, readHrFileMeta, validateHrFileMeta } from "@/lib/hr-files"
import {
  HR_DOCUMENT_CATEGORIES,
  HR_DOCUMENT_KINDS,
  defaultAttestationText,
} from "@/lib/hr-documents"
import { isOrgHrBlobUrl, requireHrDocumentAccess } from "./access"

const bodySchema = z.object({
  title: z.string().trim().min(1),
  category: z.enum(HR_DOCUMENT_CATEGORIES),
  url: z.string().url(),
  fileName: z.string().trim().min(1),
  kind: z.enum(HR_DOCUMENT_KINDS).default("Reference"),
})

// POST /api/hr/documents — ADMIN. Second leg of the browser upload: after the
// client PUT the file to the presigned URL (see ./upload-url), this registers
// the document. Metadata is read back from the stored blob — size, content
// type, and the sha256 fileHash are never trusted from the client.
//
// kind:"Acknowledgment" (HR-4) additionally requires a PDF and auto-generates
// the default checkpoint set from the actual page count: one Initial per page
// plus a final Acknowledgment. Admins refine them at /hr/documents/[id].
export async function POST(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A title, a valid category, and an uploaded file are required" },
      { status: 400 }
    )
  }
  const { title, category, url, fileName, kind } = parsed.data

  if (!isOrgHrBlobUrl(url, org.id)) {
    return NextResponse.json({ error: "Invalid file reference" }, { status: 400 })
  }

  const isAcknowledgment = kind === "Acknowledgment"
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

  // Signature documents get stamped and appended to by the signed-PDF service;
  // that only works on PDFs, and the page count drives the default checkpoints.
  let pageCount = 0
  if (isAcknowledgment) {
    if (meta.contentType !== "application/pdf") {
      return NextResponse.json(
        { error: "Signature documents must be PDFs" },
        { status: 400 }
      )
    }
    try {
      const pdf = await PDFDocument.load(meta.bytes!, { ignoreEncryption: true })
      pageCount = pdf.getPageCount()
    } catch {
      return NextResponse.json(
        { error: "The PDF could not be read — re-export it and try again" },
        { status: 400 }
      )
    }
    if (pageCount < 1) {
      return NextResponse.json({ error: "The PDF has no pages" }, { status: 400 })
    }
  }

  const doc = await prisma.hrDocument.create({
    data: {
      organizationId: org.id,
      kind,
      title,
      category,
      requiresAcknowledgment: isAcknowledgment,
      isActive: true,
      versions: {
        create: {
          versionNumber: 1,
          fileUrl: meta.url,
          fileName,
          contentType: meta.contentType,
          sizeBytes: meta.sizeBytes,
          fileHash: meta.fileHash,
          isCurrent: true,
          uploadedByUserId: dbUser.id,
        },
      },
      ...(isAcknowledgment
        ? {
            checkpoints: {
              create: [
                ...Array.from({ length: pageCount }, (_, i) => ({
                  name: `Page ${i + 1} initials`,
                  type: "Initial" as const,
                  orderIndex: i,
                  pageRef: i + 1,
                })),
                {
                  name: "Final acknowledgment",
                  type: "Acknowledgment" as const,
                  orderIndex: pageCount,
                  pageRef: pageCount,
                  attestationText: defaultAttestationText(title),
                },
              ],
            },
          }
        : {}),
    },
    include: { versions: true },
  })

  // HR-11b: scan the version's text layer for field anchors and persist them as
  // unconfirmed proposals for the admin to confirm on /hr/documents/[id]. Best
  // effort — a scan failure or an image-only PDF just leaves zero anchors
  // (certificate-only fallback) and never blocks the upload. Clone the bytes:
  // pdfjs may detach the buffer during parsing.
  if (isAcknowledgment && meta.bytes && doc.versions[0]) {
    await detectAndStoreVersionAnchors(doc.versions[0].id, new Uint8Array(meta.bytes))
  }

  return NextResponse.json(doc, { status: 201 })
}
