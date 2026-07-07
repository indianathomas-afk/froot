import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { ingredientDisplayName, requireCount, userNamesById } from "@/lib/count-access"

// GET /api/inventory/counts/[id] — the counting screen payload: lines grouped by
// storage area (in walk order), plus the store's active ingredient roster so the
// client can drive the unassigned triage panel and per-area "add & count" pickers
// without extra round-trips.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count, org } = ctx

  const [lines, areas, store, names] = await Promise.all([
    prisma.inventoryCountLine.findMany({
      where: { inventoryCountId: count.id },
      include: {
        ingredient: {
          select: {
            unitsPerPurchase: true,
            purchaseUnitLabel: true,
            tareWeightOz: true,
            fullWeightOz: true,
            costPerReportingUnit: true,
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.storageArea.findMany({
      where: { organizationId: org.id, storeId: count.storeId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.store.findFirst({ where: { id: count.storeId, organizationId: org.id } }),
    userNamesById(count.completedByUserIds),
  ])

  const serializeLine = (l: (typeof lines)[number]) => ({
    id: l.id,
    storageAreaId: l.storageAreaId,
    ingredientId: l.ingredientId,
    ingredientName: l.ingredientName,
    reportingUnit: l.reportingUnit,
    quantityCounted: l.quantityCounted,
    costPerReportingUnit: l.costPerReportingUnit,
    lineValue: l.lineValue,
    sortOrder: l.sortOrder,
    countedAt: l.countedAt ? l.countedAt.toISOString() : null,
    unitsPerPurchase: l.ingredient.unitsPerPurchase,
    purchaseUnitLabel: l.ingredient.purchaseUnitLabel,
    tareWeightOz: l.ingredient.tareWeightOz,
    fullWeightOz: l.ingredient.fullWeightOz,
    currentCostPerReportingUnit: l.ingredient.costPerReportingUnit,
  })

  const grouped = areas.map((area) => ({
    id: area.id,
    name: area.name,
    sortOrder: area.sortOrder,
    lines: lines.filter((l) => l.storageAreaId === area.id).map(serializeLine),
  }))
  // Lines whose area was deleted after the snapshot still need to be visible.
  const orphaned = lines.filter((l) => !l.storageAreaId || !areas.some((a) => a.id === l.storageAreaId))
  if (orphaned.length > 0) {
    grouped.push({ id: "unareaed", name: "No storage area", sortOrder: Number.MAX_SAFE_INTEGER, lines: orphaned.map(serializeLine) })
  }

  // Active roster only matters while the draft is editable (triage + mid-count add).
  const activeIngredients =
    count.status === "Draft"
      ? (
          await prisma.ingredient.findMany({
            where: { organizationId: org.id, deletedAt: null, isArchived: false },
            include: { category: true },
            orderBy: { name: "asc" },
          })
        ).map((i) => ({
          id: i.id,
          name: ingredientDisplayName(i),
          categoryName: i.category?.name ?? null,
          reportingUnit: i.reportingUnit,
          costPerReportingUnit: i.costPerReportingUnit,
        }))
      : []

  return NextResponse.json({
    id: count.id,
    storeId: count.storeId,
    storeName: store?.name ?? "",
    name: count.name,
    notes: count.notes,
    status: count.status,
    isPartial: count.isPartial,
    startedAt: count.startedAt.toISOString(),
    finalizedAt: count.finalizedAt ? count.finalizedAt.toISOString() : null,
    sittingInventoryVal: count.sittingInventoryVal,
    countedByNames: count.completedByUserIds.map((uid) => names.get(uid)).filter((n): n is string => !!n),
    areas: grouped,
    activeIngredients,
  })
}

// DELETE — discard a Draft. Finalized counts are records, never deleted.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error

  if (ctx.count.status !== "Draft") {
    return NextResponse.json({ error: "Only draft counts can be deleted" }, { status: 409 })
  }

  await prisma.inventoryCount.delete({ where: { id: ctx.count.id } })
  return NextResponse.json({ success: true })
}
