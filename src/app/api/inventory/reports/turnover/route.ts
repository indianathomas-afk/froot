import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import { countLineRollup, getInventoryPeriods, periodSalesWindow, receivedLinesInWindow } from "@/lib/reports"

// GET /api/inventory/reports/turnover?storeId=&from=&to= — per-ingredient usage
// quantity vs. average on-hand across the periods in the window. Flags fast
// movers (top decile by usage $) and dead stock (no usage in the last 2+
// periods while stock was on hand).
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })
  if (!ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  let periods = await getInventoryPeriods(ctx.org.id, storeId)
  if (from) periods = periods.filter((p) => periodSalesWindow(p, store.timezone).end >= from)
  if (to) periods = periods.filter((p) => periodSalesWindow(p, store.timezone).start <= to)
  if (periods.length === 0) return NextResponse.json({ ingredients: [], periodCount: 0 })

  type Row = {
    ingredientId: string
    ingredientName: string
    reportingUnit: string | null
    usageQty: number
    usageValue: number
    onHandSamples: number[]
    perPeriodUsage: number[]
  }
  const rows = new Map<string, Row>()

  const units = new Map<string, string>()
  const ingredients = await prisma.ingredient.findMany({
    where: { organizationId: ctx.org.id },
    select: { id: true, reportingUnit: true },
  })
  for (const i of ingredients) units.set(i.id, i.reportingUnit)

  for (const period of periods) {
    const [beginLines, endLines, received] = await Promise.all([
      countLineRollup(period.begin.countId),
      countLineRollup(period.end.countId),
      receivedLinesInWindow(ctx.org.id, storeId, period.begin.finalizedAt, period.end.finalizedAt),
    ])
    const receivedQty = new Map<string, number>()
    const receivedVal = new Map<string, number>()
    for (const l of received) {
      receivedQty.set(l.ingredientId, (receivedQty.get(l.ingredientId) ?? 0) + l.quantityReceived * l.unitsPerPurchase)
      receivedVal.set(l.ingredientId, (receivedVal.get(l.ingredientId) ?? 0) + l.value)
    }

    const ids = new Set([...beginLines.keys(), ...endLines.keys(), ...receivedQty.keys()])
    for (const id of ids) {
      const begin = beginLines.get(id)
      const end = endLines.get(id)
      const usageQty = (begin?.qty ?? 0) + (receivedQty.get(id) ?? 0) - (end?.qty ?? 0)
      const usageValue = (begin?.value ?? 0) + (receivedVal.get(id) ?? 0) - (end?.value ?? 0)
      const row: Row = rows.get(id) ?? {
        ingredientId: id,
        ingredientName: begin?.ingredientName ?? end?.ingredientName ?? id,
        reportingUnit: units.get(id) ?? null,
        usageQty: 0,
        usageValue: 0,
        onHandSamples: [],
        perPeriodUsage: [],
      }
      row.usageQty += usageQty
      row.usageValue += usageValue
      row.onHandSamples.push(((begin?.qty ?? 0) + (end?.qty ?? 0)) / 2)
      row.perPeriodUsage.push(usageQty)
      rows.set(id, row)
    }
  }

  const list = [...rows.values()].map((r) => {
    const avgOnHand = r.onHandSamples.length
      ? r.onHandSamples.reduce((s, q) => s + q, 0) / r.onHandSamples.length
      : 0
    const lastTwo = r.perPeriodUsage.slice(-2)
    const isDeadStock = r.perPeriodUsage.length >= 2 && lastTwo.every((u) => u <= 0.005) && avgOnHand > 0
    return {
      ingredientId: r.ingredientId,
      ingredientName: r.ingredientName,
      reportingUnit: r.reportingUnit,
      usageQty: r.usageQty,
      usageValue: r.usageValue,
      avgOnHandQty: avgOnHand,
      turns: avgOnHand > 0 ? r.usageQty / avgOnHand : null,
      isDeadStock,
      isFastMover: false, // set below
    }
  })

  // Fast movers: top decile by usage value (min 1 item when anything moved).
  const byValue = [...list].filter((r) => r.usageValue > 0).sort((a, b) => b.usageValue - a.usageValue)
  const fastCount = Math.max(byValue.length > 0 ? 1 : 0, Math.floor(byValue.length / 10))
  const fastIds = new Set(byValue.slice(0, fastCount).map((r) => r.ingredientId))
  for (const r of list) r.isFastMover = fastIds.has(r.ingredientId)

  list.sort((a, b) => b.usageValue - a.usageValue)
  return NextResponse.json({ ingredients: list, periodCount: periods.length })
}
