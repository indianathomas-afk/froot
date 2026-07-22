import { NextResponse } from "next/server"
import { z } from "zod"
import { HR_DOCUMENT_CATEGORIES } from "@/lib/hr-documents"
import { createFillableForm } from "@/lib/hr-forms"
import { requireHrDocumentAccess } from "../documents/access"
import { FORM_BODY_TEXT_MAX, formFieldsSchema } from "./shared"

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(HR_DOCUMENT_CATEGORIES),
  // Both default empty: the create dialog makes a draft shell, the builder
  // fills in the agreement language and fields before anyone executes it.
  bodyText: z.string().max(FORM_BODY_TEXT_MAX).default(""),
  fields: formFieldsSchema.default([]),
})

// POST /api/hr/forms — ADMIN. Creates a kind:"FillableForm" HrDocument with
// its v1 definition version (canonical JSON snapshot + sha256 pin). Forms are
// built natively — no file upload — and never join the Reference library.
export async function POST(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue?.message ?? "A title and a valid category are required" },
      { status: 400 }
    )
  }
  const { title, category, bodyText, fields } = parsed.data

  const doc = await createFillableForm({
    organizationId: org.id,
    createdByUserId: dbUser.id,
    title,
    category,
    bodyText,
    fields,
  })

  return NextResponse.json(doc, { status: 201 })
}
