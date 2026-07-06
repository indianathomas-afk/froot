import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const CreateSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1).max(100),
})

// GET /api/inventory/storage-areas?storeId=... → the store's areas with their
// ordered ingredient mappings, plus unassigned[]: active ingredients with no
// mapping anywhere in this store (they can't be counted until assigned).
export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const areas = await prisma.storageArea.findMany({
    where: { organizationId: org.id, storeId },
    include: {
      ingredientMappings: {
        include: { ingredient: { include: { category: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  })

  const assignedIngredientIds = new Set(areas.flatMap((a) => a.ingredientMappings.map((m) => m.ingredientId)))

  const activeIngredients = await prisma.ingredient.findMany({
    where: { organizationId: org.id, deletedAt: null, isArchived: false },
    include: { category: true },
    orderBy: { name: "asc" },
  })

  const unassigned = activeIngredients
    .filter((i) => !assignedIngredientIds.has(i.id))
    .map((i) => ({
      ingredientId: i.id,
      brand: i.brand,
      name: i.name,
      categoryName: i.category?.name ?? null,
      reportingUnit: i.reportingUnit,
      costPerReportingUnit: i.costPerReportingUnit,
    }))

  return NextResponse.json({
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      sortOrder: a.sortOrder,
      // Archived/deleted ingredients keep their mapping rows (so a restore puts
      // them right back) but are hidden from the working view.
      ingredients: a.ingredientMappings
        .filter((m) => m.ingredient.deletedAt === null && !m.ingredient.isArchived)
        .map((m) => ({
          mappingId: m.id,
          ingredientId: m.ingredientId,
          sortOrder: m.sortOrder,
          brand: m.ingredient.brand,
          name: m.ingredient.name,
          categoryName: m.ingredient.category?.name ?? null,
          reportingUnit: m.ingredient.reportingUnit,
          costPerReportingUnit: m.ingredient.costPerReportingUnit,
        })),
    })),
    unassigned,
  })
}

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
  const data = CreateSchema.parse(body)

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: data.storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const maxSort = await prisma.storageArea.aggregate({
    where: { storeId: data.storeId },
    _max: { sortOrder: true },
  })

  const area = await prisma.storageArea.create({
    data: {
      organizationId: org.id,
      storeId: data.storeId,
      name: data.name,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  })

  return NextResponse.json(area, { status: 201 })
}
