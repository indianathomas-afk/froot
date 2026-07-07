import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext, ingredientDisplayName } from "@/lib/count-access"
import { computeExpectedInventory, computeWeeklyUsage } from "@/lib/expected-inventory"

// GET /api/inventory/order-guide?storeId=
// Everything the Cart Builder needs in one payload: per orderable ingredient
// the two inventory bases (latest finalized count / expected), the ordering
// guides (avg weekly usage / par / reorder point), and vendor prices on file.
// PREPARED ingredients are excluded — they're made in-house, not ordered.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })
  if (!ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const [expected, weekly, pars, ingredients, vendors] = await Promise.all([
    computeExpectedInventory(ctx.org, store),
    computeWeeklyUsage(ctx.org, store),
    prisma.storeIngredientPar.findMany({ where: { storeId, organizationId: ctx.org.id } }),
    prisma.ingredient.findMany({
      where: {
        organizationId: ctx.org.id,
        deletedAt: null,
        isArchived: false,
        isActive: true,
        kind: "PURCHASED",
      },
      include: {
        category: { select: { name: true } },
        vendorIngredients: {
          where: { vendor: { isActive: true } },
          include: { vendor: { select: { id: true, name: true } } },
          orderBy: { casePrice: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.vendor.findMany({
      where: { organizationId: ctx.org.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, leadTimeDays: true },
    }),
  ])

  const expectedById = new Map(expected.rows.map((r) => [r.ingredientId, r]))
  const parById = new Map(pars.map((p) => [p.ingredientId, p]))

  const rows = ingredients.map((i) => {
    const exp = expectedById.get(i.id)
    const par = parById.get(i.id)
    return {
      ingredientId: i.id,
      name: ingredientDisplayName(i),
      categoryName: i.category?.name ?? null,
      reportingUnit: i.reportingUnit,
      purchaseUnitLabel: i.purchaseUnitLabel,
      packDescription: i.packDescription,
      unitsPerPurchase: i.unitsPerPurchase,
      purchaseCost: i.purchaseCost,
      latestCountQty: exp?.onLastCount ? exp.countQty : null,
      expectedQty: exp?.expectedQty ?? null,
      weeklyUsage: weekly.usage.get(i.id) ?? null,
      parLevel: par?.parLevel ?? null,
      reorderPoint: par?.reorderPoint ?? null,
      vendors: i.vendorIngredients.map((v) => ({
        vendorId: v.vendor.id,
        vendorName: v.vendor.name,
        casePrice: v.casePrice,
        vendorSku: v.vendorSku,
      })),
    }
  })

  return NextResponse.json({
    storeId,
    baseCount: expected.baseCount,
    daysSinceCount: expected.daysSinceCount,
    isStale: expected.isStale,
    salesDataComplete: expected.salesDataComplete,
    usageBasis: weekly.basis,
    rows,
    allVendors: vendors,
  })
}
