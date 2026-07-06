import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCount, userNamesById } from "@/lib/count-access"

// GET /api/inventory/counts/[id]/summary — post-finalize review: per-ingredient
// rollup across areas (sortable by value to spot $0.00 lines and unit/case
// miscounts), previous-count comparison per area, cost-drift flags, and the
// corrections audit trail.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count, org } = ctx

  const [lines, areas, store, corrections, names] = await Promise.all([
    prisma.inventoryCountLine.findMany({
      where: { inventoryCountId: count.id },
      include: { ingredient: { select: { costPerReportingUnit: true } } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.storageArea.findMany({ where: { organizationId: org.id, storeId: count.storeId } }),
    prisma.store.findFirst({ where: { id: count.storeId, organizationId: org.id } }),
    prisma.inventoryCountCorrection.findMany({
      where: { countId: count.id },
      orderBy: { createdAt: "desc" },
    }),
    userNamesById(count.completedByUserIds),
  ])

  // Previous finalized count for this store — the per-area comparison that makes
  // an abnormal number obviously a miscount rather than a mystery.
  const previous = count.finalizedAt
    ? await prisma.inventoryCount.findFirst({
        where: {
          organizationId: org.id,
          storeId: count.storeId,
          status: "Finalized",
          finalizedAt: { lt: count.finalizedAt },
        },
        include: { lines: true },
        orderBy: { finalizedAt: "desc" },
      })
    : null
  const prevByKey = new Map(
    (previous?.lines ?? []).map((l) => [`${l.ingredientId}:${l.storageAreaId ?? ""}`, l.quantityCounted])
  )

  const areaName = new Map(areas.map((a) => [a.id, a.name]))

  const byIngredient = new Map<
    string,
    {
      ingredientId: string
      ingredientName: string
      reportingUnit: string
      totalQuantity: number
      totalValue: number
      currentCostPerReportingUnit: number
      lines: {
        lineId: string
        storageAreaId: string | null
        areaName: string
        quantityCounted: number | null
        costPerReportingUnit: number
        lineValue: number | null
        previousQuantity: number | null
      }[]
    }
  >()

  for (const l of lines) {
    let entry = byIngredient.get(l.ingredientId)
    if (!entry) {
      entry = {
        ingredientId: l.ingredientId,
        ingredientName: l.ingredientName,
        reportingUnit: l.reportingUnit,
        totalQuantity: 0,
        totalValue: 0,
        currentCostPerReportingUnit: l.ingredient.costPerReportingUnit,
        lines: [],
      }
      byIngredient.set(l.ingredientId, entry)
    }
    entry.totalQuantity += l.quantityCounted ?? 0
    entry.totalValue += l.lineValue ?? (l.quantityCounted ?? 0) * l.costPerReportingUnit
    entry.lines.push({
      lineId: l.id,
      storageAreaId: l.storageAreaId,
      areaName: l.storageAreaId ? areaName.get(l.storageAreaId) ?? "Deleted area" : "No storage area",
      quantityCounted: l.quantityCounted,
      costPerReportingUnit: l.costPerReportingUnit,
      lineValue: l.lineValue,
      previousQuantity: prevByKey.get(`${l.ingredientId}:${l.storageAreaId ?? ""}`) ?? null,
    })
  }

  const ingredients = [...byIngredient.values()].map((entry) => {
    // Snapshot cost for display: value-weighted when corrections made lines
    // diverge; falls back to the first line's snapshot for zero quantities.
    const snapshotCost = entry.totalQuantity > 0 ? entry.totalValue / entry.totalQuantity : entry.lines[0].costPerReportingUnit
    const drift =
      snapshotCost > 0
        ? Math.abs(entry.currentCostPerReportingUnit - snapshotCost) / snapshotCost
        : entry.currentCostPerReportingUnit > 0
          ? 1
          : 0
    return {
      ...entry,
      snapshotCostPerReportingUnit: snapshotCost,
      // >50% snapshot-vs-current drift = "cost changed since count" red badge.
      costDrift: drift > 0.5,
    }
  })

  const correctionNames = await userNamesById(corrections.map((c) => c.userId))

  return NextResponse.json({
    id: count.id,
    storeId: count.storeId,
    storeName: store?.name ?? "",
    name: count.name,
    notes: count.notes,
    status: count.status,
    isPartial: count.isPartial,
    finalizedAt: count.finalizedAt ? count.finalizedAt.toISOString() : null,
    sittingInventoryVal: count.sittingInventoryVal,
    countedByNames: count.completedByUserIds.map((uid) => names.get(uid)).filter((n): n is string => !!n),
    previousCount: previous
      ? { id: previous.id, name: previous.name, finalizedAt: previous.finalizedAt?.toISOString() ?? null }
      : null,
    ingredients,
    corrections: corrections.map((c) => ({
      id: c.id,
      lineId: c.lineId,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      note: c.note,
      userName: correctionNames.get(c.userId) ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  })
}
