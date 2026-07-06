import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const ReplaceSchema = z.object({
  ingredients: z.array(
    z.object({
      ingredientId: z.string().min(1),
      sortOrder: z.number().int().nonnegative(),
    })
  ),
})

// PUT /api/inventory/storage-areas/[id]/ingredients — replace the area's
// ordered ingredient list (drag-to-reorder, add, remove all land here).
// Removing a mapping only removes the assignment, never the ingredient.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const area = await prisma.storageArea.findFirst({ where: { id, organizationId: org.id } })
  if (!area) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(area.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const data = ReplaceSchema.parse(body)

  const ingredientIds = data.ingredients.map((i) => i.ingredientId)
  if (new Set(ingredientIds).size !== ingredientIds.length) {
    return NextResponse.json({ error: "Duplicate ingredient in list" }, { status: 400 })
  }

  const owned = await prisma.ingredient.count({
    where: { id: { in: ingredientIds }, organizationId: org.id, deletedAt: null },
  })
  if (owned !== ingredientIds.length) {
    return NextResponse.json({ error: "One or more ingredients not found" }, { status: 404 })
  }

  // Archived ingredients are hidden from the UI but their mappings must survive —
  // keep them while replacing the visible (active) list the client sent.
  const archivedMappings = await prisma.ingredientStorageMapping.findMany({
    where: {
      storageAreaId: id,
      ingredient: { OR: [{ isArchived: true }, { deletedAt: { not: null } }] },
    },
  })
  const archivedIds = new Set(archivedMappings.map((m) => m.ingredientId))

  await prisma.$transaction([
    prisma.ingredientStorageMapping.deleteMany({
      where: { storageAreaId: id, ingredientId: { notIn: [...archivedIds] } },
    }),
    prisma.ingredientStorageMapping.createMany({
      data: data.ingredients
        .filter((i) => !archivedIds.has(i.ingredientId))
        .map((i) => ({ storageAreaId: id, ingredientId: i.ingredientId, sortOrder: i.sortOrder })),
    }),
  ])

  return NextResponse.json({ success: true })
}
