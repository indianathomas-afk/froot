import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { dbDate } from "@/lib/reports"
import { ensureSalesCached } from "@/lib/sales-sync"
import { computeAllRecipeCosts, loadCostGraph } from "@/lib/recipe-cost"

// GET /api/inventory/reports/profitability?storeId=&from=&to=
// Per sales item over the window: qty sold, gross sales, recipe cost, cost %,
// gross profit $. UNMAPPED items surface with zero cost data and a "map it"
// link into the recipes triage queue.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  if (!storeId || !from || !to) {
    return NextResponse.json({ error: "storeId, from, and to are required" }, { status: 400 })
  }
  if (!ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  try {
    await ensureSalesCached(ctx.org, store, from, to)
  } catch {
    // non-fatal — report renders from whatever is cached
  }

  const [lines, salesItems, graph] = await Promise.all([
    prisma.salesLineCache.findMany({ where: { storeId, date: { gte: dbDate(from), lte: dbDate(to) } } }),
    prisma.salesItem.findMany({
      where: { organizationId: ctx.org.id },
      select: {
        id: true,
        squareVariationId: true,
        displayName: true,
        menuGroup: true,
        priceCents: true,
        recipeStatus: true,
        recipe: { select: { id: true } },
      },
    }),
    loadCostGraph(ctx.org.id),
  ])
  const costs = computeAllRecipeCosts(graph)

  const byVariation = new Map<string, { qty: number; gross: number }>()
  for (const l of lines) {
    const agg = byVariation.get(l.squareVariationId) ?? { qty: 0, gross: 0 }
    agg.qty += l.quantitySold
    agg.gross += l.grossSales
    byVariation.set(l.squareVariationId, agg)
  }
  const itemByVariation = new Map(salesItems.map((s) => [s.squareVariationId, s]))

  const items = [...byVariation.entries()]
    .map(([variationId, agg]) => {
      const item = itemByVariation.get(variationId)
      const recipeCost = item?.recipe ? costs.get(item.recipe.id)?.cost ?? null : null
      const totalCost = recipeCost !== null ? recipeCost * agg.qty : null
      return {
        salesItemId: item?.id ?? null,
        squareVariationId: variationId,
        displayName: item?.displayName ?? `Unknown item (${variationId.slice(0, 8)}…)`,
        menuGroup: item?.menuGroup ?? null,
        priceCents: item?.priceCents ?? null,
        recipeStatus: item?.recipeStatus ?? "UNMAPPED",
        hasRecipe: !!item?.recipe,
        quantitySold: agg.qty,
        grossSales: agg.gross,
        recipeCost,
        totalCost,
        costPct: totalCost !== null && agg.gross > 0 ? totalCost / agg.gross : null,
        grossProfit: totalCost !== null ? agg.gross - totalCost : null,
      }
    })
    .sort((a, b) => b.grossSales - a.grossSales)

  const totals = items.reduce(
    (t, i) => ({
      grossSales: t.grossSales + i.grossSales,
      totalCost: t.totalCost + (i.totalCost ?? 0),
      costedSales: t.costedSales + (i.totalCost !== null ? i.grossSales : 0),
    }),
    { grossSales: 0, totalCost: 0, costedSales: 0 }
  )

  return NextResponse.json({ items, totals, from, to })
}
