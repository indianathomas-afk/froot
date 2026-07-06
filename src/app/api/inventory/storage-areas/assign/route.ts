import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const AssignSchema = z.object({
  storeId: z.string().min(1),
  ingredientIds: z.array(z.string().min(1)).min(1),
  addAreaIds: z.array(z.string().min(1)).default([]),
  removeAreaIds: z.array(z.string().min(1)).default([]),
})

// POST /api/inventory/storage-areas/assign — bulk add/remove area assignments
// for many ingredients in one save. New mappings append at the end of each
// area's order. Also the endpoint the I-4 unassigned-item triage panel calls.
export async function POST(req: Request) {
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

  const body = await req.json()
  const data = AssignSchema.parse(body)

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const overlap = data.addAreaIds.filter((id) => data.removeAreaIds.includes(id))
  if (overlap.length > 0) {
    return NextResponse.json({ error: "An area cannot be in both add and remove lists" }, { status: 400 })
  }

  const areaIds = [...new Set([...data.addAreaIds, ...data.removeAreaIds])]
  if (areaIds.length > 0) {
    const areas = await prisma.storageArea.findMany({
      where: { id: { in: areaIds }, organizationId: org.id, storeId: data.storeId },
    })
    if (areas.length !== areaIds.length) {
      return NextResponse.json({ error: "One or more areas not found in this store" }, { status: 404 })
    }
  }

  const owned = await prisma.ingredient.count({
    where: { id: { in: data.ingredientIds }, organizationId: org.id, deletedAt: null },
  })
  if (owned !== data.ingredientIds.length) {
    return NextResponse.json({ error: "One or more ingredients not found" }, { status: 404 })
  }

  let added = 0
  let removed = 0

  await prisma.$transaction(async (tx) => {
    for (const areaId of data.addAreaIds) {
      const existing = await tx.ingredientStorageMapping.findMany({
        where: { storageAreaId: areaId },
        select: { ingredientId: true, sortOrder: true },
      })
      const existingIds = new Set(existing.map((m) => m.ingredientId))
      let nextSort = existing.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 1

      const toCreate = data.ingredientIds.filter((iid) => !existingIds.has(iid))
      if (toCreate.length > 0) {
        await tx.ingredientStorageMapping.createMany({
          data: toCreate.map((iid) => ({ storageAreaId: areaId, ingredientId: iid, sortOrder: nextSort++ })),
        })
        added += toCreate.length
      }
    }

    if (data.removeAreaIds.length > 0) {
      const result = await tx.ingredientStorageMapping.deleteMany({
        where: { storageAreaId: { in: data.removeAreaIds }, ingredientId: { in: data.ingredientIds } },
      })
      removed = result.count
    }
  })

  return NextResponse.json({ success: true, added, removed })
}
