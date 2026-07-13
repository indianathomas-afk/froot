import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { HrFileValidationError, readHrFileMeta, validateHrFileMeta } from "@/lib/hr-files"
import { HR_DOCUMENT_CATEGORIES } from "@/lib/hr-documents"
import { requireHrDocumentAccess } from "./access"

const bodySchema = z.object({
  title: z.string().trim().min(1),
  category: z.enum(HR_DOCUMENT_CATEGORIES),
  url: z.string().url(),
  fileName: z.string().trim().min(1),
})

// POST /api/hr/documents — ADMIN. Second leg of the browser upload: after the
// client PUT the file to the presigned URL (see ./upload-url), this registers
// the Reference document. Metadata is read back from the stored blob — size,
// content type, and the sha256 fileHash are never trusted from the client.
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
  const { title, category, url, fileName } = parsed.data

  // The client sends the URL the presigned PUT returned. It must be a private
  // blob URL inside this org's namespace — otherwise a doc record could be
  // pointed at a public asset or another org's file. head() below additionally
  // fails for any store our token doesn't own.
  const blobUrl = new URL(url)
  if (
    !blobUrl.hostname.endsWith(".private.blob.vercel-storage.com") ||
    !blobUrl.pathname.startsWith(`/hr/${org.id}/`)
  ) {
    return NextResponse.json({ error: "Invalid file reference" }, { status: 400 })
  }

  let meta
  try {
    meta = await readHrFileMeta(url)
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

  const doc = await prisma.hrDocument.create({
    data: {
      organizationId: org.id,
      kind: "Reference",
      title,
      category,
      requiresAcknowledgment: false,
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
    },
    include: { versions: true },
  })

  return NextResponse.json(doc, { status: 201 })
}
