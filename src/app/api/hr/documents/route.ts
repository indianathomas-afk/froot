import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { HrFileValidationError, uploadHrFile } from "@/lib/hr-files"
import { HR_DOCUMENT_CATEGORIES, type HrDocumentCategory } from "@/lib/hr-documents"
import { requireHrDocumentAccess } from "./access"

// POST /api/hr/documents — upload a Reference document into the org library.
// ADMIN only. Multipart body: { file, title, category }.
export async function POST(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 })

  const file = form.get("file")
  const title = ((form.get("title") as string | null) ?? "").trim()
  const category = (form.get("category") as string | null) ?? ""

  if (
    !(file instanceof File) ||
    !title ||
    !HR_DOCUMENT_CATEGORIES.includes(category as HrDocumentCategory)
  ) {
    return NextResponse.json(
      { error: "A file, a title, and a valid category are required" },
      { status: 400 }
    )
  }

  let uploaded
  try {
    uploaded = await uploadHrFile(file, { keyPrefix: `hr/${org.id}` })
  } catch (err) {
    if (err instanceof HrFileValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
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
          fileUrl: uploaded.url,
          fileName: uploaded.fileName,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          fileHash: uploaded.fileHash,
          isCurrent: true,
          uploadedByUserId: dbUser.id,
        },
      },
    },
    include: { versions: true },
  })

  return NextResponse.json(doc, { status: 201 })
}
