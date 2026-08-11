import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../access"
import { TrainingCategorySchema, findNameConflict, isUniqueViolation } from "./shared"

// HR-21. The org's training taxonomy — list and create for the Manage
// Categories dialog.
//
// ADMIN via requireHrTrainingAccess, the same shared guard as the module
// routes (R-e: inline pattern, zero registry edits; HR-19 migrates this seam
// later). The guard resolves the caller's org through getCurrentUser(), and
// every query below is scoped to that org (ruling 8 — never a bare id lookup).

export async function GET() {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const categories = await prisma.trainingCategory.findMany({
    where: { organizationId: access.org.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      colorKey: true,
      sortOrder: true,
      // Org-wide and archived-inclusive, computed HERE: this count governs
      // deletion, and an archived module still holds the FK and still trips
      // ON DELETE RESTRICT. The filter chips count per-view, client-side —
      // two counts, deliberately different (TPL-1's ruling, carried).
      _count: { select: { modules: true } },
    },
  })

  return NextResponse.json(
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      colorKey: c.colorKey,
      sortOrder: c.sortOrder,
      moduleCount: c._count.modules,
    }))
  )
}

export async function POST(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const parsed = TrainingCategorySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const conflict = await findNameConflict(access.org.id, parsed.data.name)
  if (conflict) {
    return NextResponse.json({ error: `A category called "${conflict.name}" already exists` }, { status: 409 })
  }

  try {
    const created = await prisma.trainingCategory.create({
      data: {
        organizationId: access.org.id,
        name: parsed.data.name,
        colorKey: parsed.data.colorKey,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
      select: { id: true, name: true, colorKey: true, sortOrder: true },
    })
    return NextResponse.json({ ...created, moduleCount: 0 }, { status: 201 })
  } catch (err) {
    // The case-insensitive pre-check above cannot close the race; the DB
    // constraint can, and this is what turns it into an ordinary 409.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 })
    }
    throw err
  }
}
