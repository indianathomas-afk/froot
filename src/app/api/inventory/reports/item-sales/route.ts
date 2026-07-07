import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { dbDate } from "@/lib/reports"
import { ensureSalesCached } from "@/lib/sales-sync"

// GET /api/inventory/reports/item-sales?storeId=&from=&to= — per Square
// variation over the inclusive local-date window: quantity sold, gross sales,
// average price, share of sales; joined to SalesItem for display name and menu
// group. I-6 adds mapped-status / theoretical-cost columns to this report.
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

  const lines = await prisma.salesLineCache.findMany({
    where: { storeId, date: { gte: dbDate(from), lte: dbDate(to) } },
  })

  const byVariation = new Map<string, { qty: number; gross: number }>()
  for (const l of lines) {
    const agg = byVariation.get(l.squareVariationId) ?? { qty: 0, gross: 0 }
    agg.qty += l.quantitySold
    agg.gross += l.grossSales
    byVariation.set(l.squareVariationId, agg)
  }

  const salesItems = await prisma.salesItem.findMany({
    where: { organizationId: ctx.org.id, squareVariationId: { in: [...byVariation.keys()] } },
  })
  const itemByVariation = new Map(salesItems.map((s) => [s.squareVariationId, s]))

  const totalGross = [...byVariation.values()].reduce((s, v) => s + v.gross, 0)

  const items = [...byVariation.entries()]
    .map(([variationId, agg]) => {
      const item = itemByVariation.get(variationId)
      return {
        squareVariationId: variationId,
        displayName: item?.displayName ?? `Unknown item (${variationId.slice(0, 8)}…)`,
        menuGroup: item?.menuGroup ?? null,
        priceCents: item?.priceCents ?? null,
        quantitySold: agg.qty,
        grossSales: agg.gross,
        avgPrice: agg.qty > 0 ? agg.gross / agg.qty : null,
        pctOfSales: totalGross > 0 ? agg.gross / totalGross : 0,
      }
    })
    .sort((a, b) => b.grossSales - a.grossSales)

  return NextResponse.json({ items, totalGross, from, to })
}
