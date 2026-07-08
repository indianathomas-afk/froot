import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import {
  adjustmentRollupInWindow,
  countLineRollup,
  dbDate,
  getInventoryPeriods,
  periodSalesWindow,
  receivedLinesInWindow,
  signedQtyAllTypes,
} from "@/lib/reports"
import { ensureSalesCached } from "@/lib/sales-sync"
import { expandRecipeToIngredients, loadCostGraph } from "@/lib/recipe-cost"

// GET /api/inventory/reports/variance?storeId=&beginCountId=&endCountId=
// Per ingredient over ONE inventory period:
//   used = beginning + purchases + Σ signed recorded adjustments − ending
//          (ALL adjustment types — recorded waste/transfers/prep/corrections are
//          explained movement, so what remains is sales usage + shrink)
//   sold = Σ (quantitySold + manual VarianceAdjustment deltas) × recipe
//          amounts, sub-recipes AND prepared items expanded
//   variance = sold − used, so NEGATIVE means product left the shelf that
//   sales don't explain (over-portioning, unrecorded loss/comps, missing
//   delivery, mapping mistake) and positive means the opposite direction
//   (miscount, negative usage, mapping mistake). Only ingredients present on a
//   boundary count or mapped to something sold appear.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const beginCountId = url.searchParams.get("beginCountId")
  const endCountId = url.searchParams.get("endCountId")
  if (!storeId || !beginCountId || !endCountId) {
    return NextResponse.json({ error: "storeId, beginCountId and endCountId are required" }, { status: 400 })
  }
  if (!ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const periods = await getInventoryPeriods(ctx.org.id, storeId)
  const period = periods.find((p) => p.begin.countId === beginCountId && p.end.countId === endCountId)
  if (!period) return NextResponse.json({ error: "Period not found" }, { status: 404 })

  const window = periodSalesWindow(period, store.timezone)
  const periodKey = `${beginCountId}_${endCountId}`

  try {
    if (window.start <= window.end) await ensureSalesCached(ctx.org, store, window.start, window.end)
  } catch {
    // non-fatal — report renders from whatever is cached
  }

  const [beginLines, endLines, received, adjustments, salesLines, varianceAdjustments, graph] = await Promise.all([
    countLineRollup(beginCountId),
    countLineRollup(endCountId),
    receivedLinesInWindow(ctx.org.id, storeId, period.begin.finalizedAt, period.end.finalizedAt),
    adjustmentRollupInWindow(ctx.org.id, storeId, period.begin.finalizedAt, period.end.finalizedAt),
    prisma.salesLineCache.findMany({
      where: { storeId, date: { gte: dbDate(window.start), lte: dbDate(window.end) } },
    }),
    prisma.varianceAdjustment.findMany({ where: { storeId, periodKey, organizationId: ctx.org.id } }),
    loadCostGraph(ctx.org.id),
  ])

  // qty sold per variation → per sales item, plus manual deltas (Square data
  // itself stays untouched — deltas live only in VarianceAdjustment).
  const qtyByVariation = new Map<string, number>()
  for (const l of salesLines) {
    qtyByVariation.set(l.squareVariationId, (qtyByVariation.get(l.squareVariationId) ?? 0) + l.quantitySold)
  }
  const salesItems = await prisma.salesItem.findMany({
    where: { organizationId: ctx.org.id },
    select: { id: true, squareVariationId: true, displayName: true, recipeStatus: true, recipe: { select: { id: true } } },
  })
  const deltaBySalesItem = new Map(varianceAdjustments.map((v) => [v.salesItemId, v]))

  // Theoretical (sold) quantities per ingredient, with per-item contributions
  // for the hover math.
  const soldQty = new Map<string, number>()
  const soldContributions = new Map<string, { salesItemId: string; displayName: string; qtySold: number; qty: number }[]>()
  const expansionProblems: { salesItemId: string; displayName: string }[] = []
  let unmappedSoldCount = 0

  for (const item of salesItems) {
    const rawQty = qtyByVariation.get(item.squareVariationId) ?? 0
    const delta = deltaBySalesItem.get(item.id)?.qtyDelta ?? 0
    const qtySold = rawQty + delta
    if (qtySold === 0) continue
    if (!item.recipe) {
      if (item.recipeStatus !== "NON_RECIPE" && rawQty > 0) unmappedSoldCount++
      continue
    }
    const expanded = expandRecipeToIngredients(graph, item.recipe.id, qtySold, "theoretical")
    if (expanded === null) {
      expansionProblems.push({ salesItemId: item.id, displayName: item.displayName })
      continue
    }
    for (const [ingredientId, qty] of expanded) {
      soldQty.set(ingredientId, (soldQty.get(ingredientId) ?? 0) + qty)
      const list = soldContributions.get(ingredientId) ?? []
      list.push({ salesItemId: item.id, displayName: item.displayName, qtySold, qty })
      soldContributions.set(ingredientId, list)
    }
  }

  // Purchases per ingredient in reporting units.
  const purchasedQty = new Map<string, number>()
  const purchasedValue = new Map<string, number>()
  for (const l of received) {
    purchasedQty.set(l.ingredientId, (purchasedQty.get(l.ingredientId) ?? 0) + l.quantityReceived * l.unitsPerPurchase)
    purchasedValue.set(l.ingredientId, (purchasedValue.get(l.ingredientId) ?? 0) + l.value)
  }

  // Only ingredients on a boundary count or mapped to something sold.
  const ids = new Set<string>([...beginLines.keys(), ...endLines.keys(), ...soldQty.keys()])

  // Vendor names for grouping (primary = first vendor price on file).
  const vendorLinks = await prisma.vendorIngredient.findMany({
    where: { ingredientId: { in: [...ids] } },
    include: { vendor: { select: { name: true } } },
    orderBy: { casePrice: "asc" },
  })
  const vendorByIngredient = new Map<string, string>()
  for (const v of vendorLinks) {
    if (!vendorByIngredient.has(v.ingredientId)) vendorByIngredient.set(v.ingredientId, v.vendor.name)
  }

  const ingredientMeta = await prisma.ingredient.findMany({
    where: { id: { in: [...ids] } },
    include: { category: { select: { name: true } } },
  })
  const metaById = new Map(ingredientMeta.map((i) => [i.id, i]))

  const rows = [...ids].map((id) => {
    const begin = beginLines.get(id)
    const end = endLines.get(id)
    const meta = metaById.get(id)
    const adj = adjustments.perIngredient.get(id)?.byType ?? {}
    const beginQty = begin?.qty ?? 0
    const endQty = end?.qty ?? 0
    const purchQty = purchasedQty.get(id) ?? 0
    const adjQty = signedQtyAllTypes(adj)
    const usedQty = beginQty + purchQty + adjQty - endQty
    const theoreticalQty = soldQty.get(id) ?? 0
    const varianceQty = theoreticalQty - usedQty
    // Cost basis: ending count snapshot, else beginning, else current.
    const costPerUnit =
      (end && end.qty > 0 ? end.value / end.qty : null) ??
      (begin && begin.qty > 0 ? begin.value / begin.qty : null) ??
      meta?.costPerReportingUnit ??
      0
    return {
      ingredientId: id,
      ingredientName: meta?.name ?? begin?.ingredientName ?? end?.ingredientName ?? "Unknown",
      reportingUnit: meta?.reportingUnit ?? begin?.reportingUnit ?? end?.reportingUnit ?? "",
      categoryName: meta?.category?.name ?? begin?.categoryName ?? end?.categoryName ?? null,
      vendorName: vendorByIngredient.get(id) ?? null,
      isPrepared: meta?.kind === "PREPARED",
      beginQty,
      purchasedQty: purchQty,
      endQty,
      adjustmentsByType: adj,
      usedQty,
      theoreticalQty,
      soldContributions: (soldContributions.get(id) ?? []).sort((a, b) => b.qty - a.qty),
      varianceQty,
      varianceValue: varianceQty * costPerUnit,
      costPerUnit,
      onlyOnCounts: theoreticalQty === 0,
    }
  })

  rows.sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue))

  return NextResponse.json({
    periodKey,
    startDate: window.start,
    endDate: window.end,
    rows,
    manualAdjustments: varianceAdjustments,
    // Mapped items only — manual sold-qty corrections only matter where a
    // recipe translates quantity into ingredient usage.
    salesItemOptions: salesItems
      .filter((s) => s.recipe)
      .map((s) => ({ id: s.id, displayName: s.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    expansionProblems,
    unmappedSoldCount,
  })
}
