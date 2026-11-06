import { RESTRICT_MESSAGES, refuseIfRestricted } from "@/lib/db/restrict-violation"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../../access"
import { TrainingCategorySchema, findNameConflict, isUniqueViolation } from "../shared"

// HR-21. Rename, recolor, reorder and delete for one training category.
//
// EVERY lookup is scoped with organizationId, not just the first one — a
// category id from another org must be indistinguishable from one that does
// not exist.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const existing = await prisma.trainingCategory.findFirst({
    where: { id, organizationId: access.org.id },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = TrainingCategorySchema.partial().safeParse(await req.json().catch(() => null))
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

  // A plain update, no transaction — unlike the template-types precedent,
  // nothing else was ever kept in step with a rename here: both views render
  // the joined category, so a new name or colour propagates through the join
  // alone. The dialog confirms a rename with the affected count before firing.
  try {
    const updated = await prisma.trainingCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.colorKey !== undefined && { colorKey: data.colorKey }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
      select: { id: true, name: true, colorKey: true, sortOrder: true, _count: { select: { modules: true } } },
    })

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      colorKey: updated.colorKey,
      sortOrder: updated.sortOrder,
      moduleCount: updated._count.modules,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const existing = await prisma.trainingCategory.findFirst({
    where: { id, organizationId: access.org.id },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // BLOCK while in use, with the count; reassignment is a separate act that
  // unlocks this (ruling 4, the Manage Types shape). Never cascade-to-null.
  // Counts EVERY module, archived included — an archived module still holds
  // the FK, and the FK's ON DELETE RESTRICT is the backstop behind this check
  // rather than the message the operator sees. If a module lands on this
  // category between the count and the delete, RESTRICT refuses. Since BUG-24
  // the shared matcher turns that race into a 409, not a 500 (the SQLSTATE is
  // on the adapter error's `.cause`; see src/lib/db/restrict-violation.ts).
  const moduleCount = await prisma.trainingModule.count({
    where: { categoryId: id, organizationId: access.org.id },
  })
  if (moduleCount > 0) {
    return NextResponse.json(
      {
        error: `${moduleCount} module${moduleCount === 1 ? "" : "s"} still use this category — reassign them first`,
        moduleCount,
      },
      { status: 409 }
    )
  }

  const refused = await refuseIfRestricted(
    () => prisma.trainingCategory.delete({ where: { id } }),
    RESTRICT_MESSAGES.trainingCategory,
    "DELETE /api/hr/training/categories/[id]",
  )
  if (refused) return refused
  return NextResponse.json({ success: true })
}
