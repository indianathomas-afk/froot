import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrDocumentAccess } from "../../access"
import { DocumentCategorySchema, documentCountPhrase, findNameConflict, isUniqueViolation } from "../shared"

// DOC-5. Rename, recolor, reorder and delete for one document category.
// Copied from api/hr/training/categories/[id]/route.ts.
//
// EVERY lookup is scoped with organizationId — a category id from another org
// must be indistinguishable from one that does not exist.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const { id } = await params
  const existing = await prisma.hrDocumentCategory.findFirst({
    where: { id, organizationId: access.org.id },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = DocumentCategorySchema.partial().safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const data = parsed.data

  if (data.name !== undefined) {
    const conflict = await findNameConflict(access.org.id, data.name, id)
    if (conflict) {
      return NextResponse.json({ error: `A category called "${conflict.name}" already exists` }, { status: 409 })
    }
  }

  // A plain update. Every reader renders the joined name, so a rename
  // propagates through the join alone. It does NOT cascade into the legacy
  // HrDocument.category string (F3) — that column is stale by design.
  try {
    const updated = await prisma.hrDocumentCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.colorKey !== undefined && { colorKey: data.colorKey }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
      select: { id: true, name: true, colorKey: true, sortOrder: true, _count: { select: { documents: true } } },
    })

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      colorKey: updated.colorKey,
      sortOrder: updated.sortOrder,
      documentCount: updated._count.documents,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const { id } = await params
  const existing = await prisma.hrDocumentCategory.findFirst({
    where: { id, organizationId: access.org.id },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // F4: HR-20's behaviour exactly — BLOCK while in use, with the count;
  // reassignment is a separate act that unlocks this. Never cascade-to-null.
  // Counts EVERY row on the category — library documents and agreement forms,
  // archived included — since each holds the FK. ON DELETE RESTRICT is the
  // backstop behind this check; a row landing between the count and the delete
  // surfaces as a 500, left deliberately per the HR-20 route's measured note.
  const documentCount = await prisma.hrDocument.count({
    where: { categoryId: id, organizationId: access.org.id },
  })
  if (documentCount > 0) {
    return NextResponse.json(
      {
        error: `${documentCountPhrase(documentCount)} still use${documentCount === 1 ? "s" : ""} this category — reassign ${documentCount === 1 ? "it" : "them"} first`,
        documentCount,
      },
      { status: 409 }
    )
  }

  await prisma.hrDocumentCategory.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
