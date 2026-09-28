import { NextResponse } from "next/server"
import { z } from "zod"
import { categoryWriteFields, resolveDocumentCategoryId } from "@/lib/document-categories"
import { createFillableForm } from "@/lib/hr-forms"
import { requireHrDocumentAccess } from "../documents/access"
import { FORM_BODY_TEXT_MAX, formFieldsSchema } from "./shared"

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  // DOC-5 (F7): forms share the document taxonomy. Null/absent = uncategorized.
  categoryId: z.string().min(1).nullish(),
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
      { error: issue?.message ?? "A title is required" },
      { status: 400 }
    )
  }
  const { title, categoryId, bodyText, fields } = parsed.data

  const resolved = await resolveDocumentCategoryId(org.id, categoryId ?? null)
  if (resolved === "invalid") {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 })
  }

  const doc = await createFillableForm({
    organizationId: org.id,
    createdByUserId: dbUser.id,
    title,
    // F3: categoryId plus the legacy string, written on create only.
    ...categoryWriteFields(resolved ?? null),
    bodyText,
    fields,
  })

  return NextResponse.json(doc, { status: 201 })
}
