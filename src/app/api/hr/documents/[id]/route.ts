import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { HR_DOCUMENT_CATEGORIES, HR_DOCUMENT_KINDS } from "@/lib/hr-documents"
import { requireHrDocumentAccess } from "../access"

const patchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    category: z.enum(HR_DOCUMENT_CATEGORIES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" })

// PATCH /api/hr/documents/[id] — ADMIN edit of a doc's title/category, and
// soft archive via isActive:false. No hard delete and no blob deletion —
// archived docs keep their versions, files, and signed records intact.
// Covers Reference and Acknowledgment; FillableForm gets its own flow in HR-5.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: access.org.id, kind: { in: [...HR_DOCUMENT_KINDS] } },
  })
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

  const updated = await prisma.hrDocument.update({
    where: { id: doc.id },
    data: parsed.data,
  })
  return NextResponse.json(updated)
}
