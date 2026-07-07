import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireCountsContext } from "@/lib/count-access"
import {
  adjustmentRollupInWindow,
  countLineRollup,
  getInventoryPeriods,
  netSalesForWindow,
  periodSalesWindow,
  receivedLinesInWindow,
  usageEquationAdjustmentValue,
  USAGE_EQUATION_TYPES,
} from "@/lib/reports"
import { ensureSalesCached } from "@/lib/sales-sync"

// GET /api/inventory/reports/cogs?storeId=&from=&to=
// One row per inventory period overlapping [from, to] (yyyy-mm-dd, optional —
// defaults to every period): beginning, purchases, ending, usage, sales,
// cost %, plus a per-GL-category breakdown with negative-usage flags.
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

  type PeriodReportRow = {
    beginCountId: string
    endCountId: string
    label: string
    startDate: string
    endDate: string
    beginning: number
    purchases: number
    ending: number
    usage: number
    sales: number
    costPct: number | null
    transfersIn: number
    transfersOut: number
    waste: number
    prepNet: number
    corrections: number
    glBreakdown: { glCode: string | null; categoryName: string | null; usage: number }[]
    negativeUsage: { ingredientId: string; ingredientName: string; usage: number }[]
  }
  const rows: PeriodReportRow[] = []
  for (const period of periods) {
    const window = periodSalesWindow(period, store.timezone)

    // Gap-fill the sales cache on demand; a failed sync (Square down, not
    // linked) still renders the report with sales = cached-only.
    try {
      if (window.start <= window.end) await ensureSalesCached(ctx.org, store, window.start, window.end)
    } catch {
      // non-fatal — report renders from whatever is cached
    }

    const [beginLines, endLines, received, sales, adjustments] = await Promise.all([
      countLineRollup(period.begin.countId),
      countLineRollup(period.end.countId),
      receivedLinesInWindow(ctx.org.id, storeId, period.begin.finalizedAt, period.end.finalizedAt),
      netSalesForWindow(storeId, window.start, window.end),
      adjustmentRollupInWindow(ctx.org.id, storeId, period.begin.finalizedAt, period.end.finalizedAt),
    ])

    const purchases = received.reduce((s, l) => s + l.value, 0)
    // I-6: usage = beginning + purchases − ending − transfersOut + transfersIn
    // (adjustment values are signed, out = negative). Prep nets ≈ 0 and
    // corrections fold in the same way; waste stays inside usage and is
    // reported separately.
    const equationAdjustments = usageEquationAdjustmentValue(adjustments.byType)
    const usage = period.begin.value + purchases - period.end.value + equationAdjustments
    const costPct = sales > 0 ? usage / sales : null
    const transfersIn = adjustments.byType["TRANSFER_IN"]?.value ?? 0
    const transfersOut = -(adjustments.byType["TRANSFER_OUT"]?.value ?? 0)
    const waste = -((adjustments.byType["WASTE"]?.value ?? 0) + (adjustments.byType["COMP"]?.value ?? 0))
    const prepNet = (adjustments.byType["PREP_CONSUME"]?.value ?? 0) + (adjustments.byType["PREP_PRODUCE"]?.value ?? 0)
    const corrections = adjustments.byType["CORRECTION"]?.value ?? 0

    // Per-ingredient usage$ → GL category rollup + negative-usage flags.
    const receivedByIngredient = new Map<string, number>()
    for (const l of received) {
      receivedByIngredient.set(l.ingredientId, (receivedByIngredient.get(l.ingredientId) ?? 0) + l.value)
    }
    const ingredientIds = new Set([
      ...beginLines.keys(),
      ...endLines.keys(),
      ...receivedByIngredient.keys(),
      ...adjustments.perIngredient.keys(),
    ])

    type GlRow = { glCode: string | null; categoryName: string | null; usage: number }
    const byGl = new Map<string, GlRow>()
    const negativeUsage: { ingredientId: string; ingredientName: string; usage: number }[] = []

    for (const id of ingredientIds) {
      const begin = beginLines.get(id)
      const end = endLines.get(id)
      const recVal = receivedByIngredient.get(id) ?? 0
      const adjByType = adjustments.perIngredient.get(id)?.byType ?? {}
      const adjVal = USAGE_EQUATION_TYPES.reduce((s, t) => s + (adjByType[t]?.value ?? 0), 0)
      const usageVal = (begin?.value ?? 0) + recVal + adjVal - (end?.value ?? 0)
      const meta = begin ?? end
      const glCode = meta?.glCode ?? null
      const categoryName = meta?.categoryName ?? null
      const key = glCode ?? "—"
      const row = byGl.get(key) ?? { glCode, categoryName, usage: 0 }
      row.usage += usageVal
      byGl.set(key, row)

      if (usageVal < -0.005) {
        negativeUsage.push({
          ingredientId: id,
          ingredientName: meta?.ingredientName ?? received.find((r) => r.ingredientId === id)?.ingredientName ?? id,
          usage: usageVal,
        })
      }
    }

    rows.push({
      beginCountId: period.begin.countId,
      endCountId: period.end.countId,
      label: `${window.start} → ${window.end}`,
      startDate: window.start,
      endDate: window.end,
      beginning: period.begin.value,
      purchases,
      ending: period.end.value,
      usage,
      sales,
      costPct,
      transfersIn,
      transfersOut,
      waste,
      prepNet,
      corrections,
      glBreakdown: [...byGl.values()].sort((a, b) => b.usage - a.usage),
      negativeUsage: negativeUsage.sort((a, b) => a.usage - b.usage),
    })
  }

  return NextResponse.json({ periods: rows })
}
