import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { HR_DOCUMENT_CATEGORIES } from "@/lib/hr-documents"
import { saveFormDefinition } from "@/lib/hr-forms"
import { requireHrDocumentAccess } from "../../documents/access"
import { FORM_BODY_TEXT_MAX, formFieldsSchema } from "../shared"

const bodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    category: z.enum(HR_DOCUMENT_CATEGORIES).optional(),
    isActive: z.boolean().optional(),
    // The definition travels as a unit: the builder always sends bodyText and
    // fields together so the canonical snapshot never mixes old and new halves.
    bodyText: z.string().max(FORM_BODY_TEXT_MAX).optional(),
    fields: formFieldsSchema.optional(),
  })
  .refine((b) => (b.bodyText === undefined) === (b.fields === undefined), {
    message: "bodyText and fields must be saved together",
  })

// PATCH /api/hr/forms/[id] — ADMIN. Metadata edits (title/category/archive)
// apply directly; a definition change goes through saveFormDefinition, which
// updates the current version in place while it is unsigned and mints a new
// version (new hash) once any submission pins the old one.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue?.message ?? "Invalid request" }, { status: 400 })
  }
  const { title, category, isActive, bodyText, fields } = parsed.data

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: org.id, kind: "FillableForm" },
  })
  if (!doc) return NextResponse.json({ error: "Form not found" }, { status: 404 })

  if (title !== undefined || category !== undefined || isActive !== undefined) {
    await prisma.hrDocument.update({
      where: { id: doc.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    })
  }

  let version: { versionId: string; versionNumber: number; hash: string; minted: boolean } | null =
    null
  if (bodyText !== undefined && fields !== undefined) {
    version = await saveFormDefinition({
      documentId: doc.id,
      savedByUserId: dbUser.id,
      bodyText,
      fields,
    })
  }

  return NextResponse.json({ id: doc.id, version })
}
