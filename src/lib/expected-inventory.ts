import { prisma } from "@/lib/prisma"
import type { Organization, Store } from "@prisma/client"
import {
  countLineRollup,
  dbDate,
  getInventoryPeriods,
  localDateStr,
  nextDateStr,
  receivedLinesInWindow,
  adjustmentRollupInWindow,
  signedQtyAllTypes,
} from "@/lib/reports"
import { ensureSalesCached } from "@/lib/sales-sync"
import { expandRecipeToIngredients, loadCostGraph } from "@/lib/recipe-cost"

// ─── Expected inventory engine (Phase I-7) ────────────────────────────────────
// Perpetual on-hand per ingredient, in reporting units, starting from the last
// FINALIZED, non-partial count:
//   expected = count qty + received PO qty − theoretical sales usage ± adjustments
// Sales usage expands recipes in CONSUMPTION mode: a sale depletes the stocked
// prepared item, not its raws — raws were already depleted when the prep batch
// was recorded (PREP_CONSUME/PREP_PRODUCE adjustments).
//
// Degraded mode: with no Square link or gaps in the sales cache the engine
// still returns count + purchases ± adjustments and flags reduced confidence —
// it never silently treats missing sales as zero usage without saying so.

/** A count older than this many days is stale — alerts still fire but carry a
 *  "count recommended" warning instead of silently trusting the number. */
export const STALE_COUNT_DAYS = 14

export type ExpectedInventoryRow = {
  ingredientId: string
  ingredientName: string
  reportingUnit: string
  purchaseUnitLabel: string
  unitsPerPurchase: number
  categoryName: string | null
  isPrepared: boolean
  /** qty on the last finalized full count (0 when absent from it) */
  countQty: number
  /** on the last finalized full count at all? false = baseline is an assumed 0 */
  onLastCount: boolean
  receivedQty: number
  /** theoretical sales depletion since the count (consumption mode) */
  soldUsageQty: number
  /** signed adjustment total since the count (waste/transfers/prep/corrections) */
  adjustmentQty: number
  expectedQty: number
  costPerReportingUnit: number
  expectedValue: number
  isNegative: boolean
}

export type ExpectedInventoryResult = {
  storeId: string
  /** null = no finalized full count exists yet — nothing can be computed */
  baseCount: { id: string; name: string | null; finalizedAt: Date } | null
  asOf: Date
  daysSinceCount: number
  isStale: boolean
  /** store is linked to Square and the cache covers every day since the count */
  salesDataComplete: boolean
  /** days since the count with no sales cache row (0 when complete) */
  missingSalesDays: number
  /** sold items with no recipe mapping — their depletion is invisible */
  unmappedSoldCount: number
  /** recipes that failed to expand (loop / unit mismatch) */
  expansionProblems: { salesItemId: string; displayName: string }[]
  rows: ExpectedInventoryRow[]
}

function eachDateStr(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const d = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Theoretical per-ingredient depletion from cached sales across an inclusive
// local-date window. Shared by the expected engine and the sales-based weekly
// usage fallback.
async function salesUsageForWindow(
  org: Organization,
  storeId: string,
  start: string,
  end: string
): Promise<{
  usage: Map<string, number>
  unmappedSoldCount: number
  expansionProblems: { salesItemId: string; displayName: string }[]
}> {
  const usage = new Map<string, number>()
  const expansionProblems: { salesItemId: string; displayName: string }[] = []
  let unmappedSoldCount = 0
  if (start > end) return { usage, unmappedSoldCount, expansionProblems }

  const [salesLines, salesItems, graph] = await Promise.all([
    prisma.salesLineCache.findMany({ where: { storeId, date: { gte: dbDate(start), lte: dbDate(end) } } }),
    prisma.salesItem.findMany({
      where: { organizationId: org.id },
      select: { id: true, squareVariationId: true, displayName: true, recipeStatus: true, recipe: { select: { id: true } } },
    }),
    loadCostGraph(org.id),
  ])

  const qtyByVariation = new Map<string, number>()
  for (const l of salesLines) {
    qtyByVariation.set(l.squareVariationId, (qtyByVariation.get(l.squareVariationId) ?? 0) + l.quantitySold)
  }

  for (const item of salesItems) {
    const qtySold = qtyByVariation.get(item.squareVariationId) ?? 0
    if (qtySold === 0) continue
    if (!item.recipe) {
      if (item.recipeStatus !== "NON_RECIPE") unmappedSoldCount++
      continue
    }
    const expanded = expandRecipeToIngredients(graph, item.recipe.id, qtySold, "consumption")
    if (expanded === null) {
      expansionProblems.push({ salesItemId: item.id, displayName: item.displayName })
      continue
    }
    for (const [ingredientId, qty] of expanded) {
      usage.set(ingredientId, (usage.get(ingredientId) ?? 0) + qty)
    }
  }
  return { usage, unmappedSoldCount, expansionProblems }
}

export async function computeExpectedInventory(org: Organization, store: Store): Promise<ExpectedInventoryResult> {
  const now = new Date()
  const baseCount = await prisma.inventoryCount.findFirst({
    where: { organizationId: org.id, storeId: store.id, status: "Finalized", isPartial: false, finalizedAt: { not: null } },
    orderBy: { finalizedAt: "desc" },
    select: { id: true, name: true, finalizedAt: true },
  })

  if (!baseCount?.finalizedAt) {
    return {
      storeId: store.id,
      baseCount: null,
      asOf: now,
      daysSinceCount: 0,
      isStale: false,
      salesDataComplete: false,
      missingSalesDays: 0,
      unmappedSoldCount: 0,
      expansionProblems: [],
      rows: [],
    }
  }

  const finalizedAt = baseCount.finalizedAt
  const tz = store.timezone
  // Sales days attributed to the open period: the day AFTER the count's local
  // date through today (same attribution rule as inventory periods in I-5).
  const salesStart = nextDateStr(localDateStr(finalizedAt, tz))
  const salesEnd = localDateStr(now, tz)

  try {
    if (salesStart <= salesEnd) await ensureSalesCached(org, store, salesStart, salesEnd)
  } catch {
    // non-fatal — degraded mode is flagged via missingSalesDays below
  }

  const [countLines, received, adjustments, sales, ingredients, cachedDays] = await Promise.all([
    countLineRollup(baseCount.id),
    receivedLinesInWindow(org.id, store.id, finalizedAt, now),
    adjustmentRollupInWindow(org.id, store.id, finalizedAt, now),
    salesUsageForWindow(org, store.id, salesStart, salesEnd),
    prisma.ingredient.findMany({
      where: { organizationId: org.id, deletedAt: null, isArchived: false, isActive: true },
      include: { category: { select: { name: true } } },
    }),
    salesStart <= salesEnd
      ? prisma.salesPeriodCache.findMany({
          where: { storeId: store.id, date: { gte: dbDate(salesStart), lte: dbDate(salesEnd) } },
          select: { date: true },
        })
      : Promise.resolve([]),
  ])

  const linked = Boolean(store.squareLocationId && org.squareAccessToken)
  const windowDays = salesStart <= salesEnd ? eachDateStr(salesStart, salesEnd) : []
  const haveDays = new Set(cachedDays.map((d) => d.date.toISOString().slice(0, 10)))
  const missingSalesDays = linked ? windowDays.filter((d) => !haveDays.has(d)).length : windowDays.length
  const salesDataComplete = linked && missingSalesDays === 0

  const receivedQty = new Map<string, number>()
  for (const l of received) {
    receivedQty.set(l.ingredientId, (receivedQty.get(l.ingredientId) ?? 0) + l.quantityReceived * l.unitsPerPurchase)
  }

  // Every active ingredient appears, plus anything with movement since the
  // count (received/adjusted/sold ingredients that were archived stay visible
  // so their movement is never hidden).
  const metaById = new Map(ingredients.map((i) => [i.id, i]))
  const ids = new Set<string>([
    ...metaById.keys(),
    ...countLines.keys(),
    ...receivedQty.keys(),
    ...adjustments.perIngredient.keys(),
    ...sales.usage.keys(),
  ])

  const extraIds = [...ids].filter((id) => !metaById.has(id))
  if (extraIds.length > 0) {
    const extra = await prisma.ingredient.findMany({
      where: { id: { in: extraIds } },
      include: { category: { select: { name: true } } },
    })
    for (const i of extra) metaById.set(i.id, i)
  }

  const daysSinceCount = Math.floor((now.getTime() - finalizedAt.getTime()) / 86_400_000)

  const rows: ExpectedInventoryRow[] = []
  for (const id of ids) {
    const meta = metaById.get(id)
    if (!meta) continue
    const count = countLines.get(id)
    const countQty = count?.qty ?? 0
    const recQty = receivedQty.get(id) ?? 0
    const soldQty = sales.usage.get(id) ?? 0
    const adjQty = signedQtyAllTypes(adjustments.perIngredient.get(id)?.byType ?? {})
    const expectedQty = countQty + recQty - soldQty + adjQty
    rows.push({
      ingredientId: id,
      ingredientName: meta.brand ? `${meta.brand} ${meta.name}` : meta.name,
      reportingUnit: meta.reportingUnit,
      purchaseUnitLabel: meta.purchaseUnitLabel,
      unitsPerPurchase: meta.unitsPerPurchase,
      categoryName: meta.category?.name ?? null,
      isPrepared: meta.kind === "PREPARED",
      countQty,
      onLastCount: count !== undefined,
      receivedQty: recQty,
      soldUsageQty: soldQty,
      adjustmentQty: adjQty,
      expectedQty,
      costPerReportingUnit: meta.costPerReportingUnit,
      expectedValue: expectedQty * meta.costPerReportingUnit,
      isNegative: expectedQty < 0,
    })
  }
  rows.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName))

  return {
    storeId: store.id,
    baseCount: { id: baseCount.id, name: baseCount.name, finalizedAt },
    asOf: now,
    daysSinceCount,
    isStale: daysSinceCount > STALE_COUNT_DAYS,
    salesDataComplete,
    missingSalesDays,
    unmappedSoldCount: sales.unmappedSoldCount,
    expansionProblems: sales.expansionProblems,
    rows,
  }
}

// ─── Average weekly usage ─────────────────────────────────────────────────────
// Per ingredient per store, in reporting units per week. Prefers REAL usage
// from finalized inventory periods (begin + purchases + signed adjustments −
// end, the variance-report identity) across up to the last 4 periods. Falls
// back to theoretical sales usage over the last 28 days when no full period
// exists yet.

/** periods averaged when real usage data exists */
const USAGE_LOOKBACK_PERIODS = 4
/** sales-based fallback lookback, days */
const USAGE_LOOKBACK_DAYS = 28

export type WeeklyUsageResult = {
  /** ingredientId → reporting units per week */
  usage: Map<string, number>
  /** "periods" = real count-to-count usage; "sales" = theoretical; "none" = no data */
  basis: "periods" | "sales" | "none"
}

export async function computeWeeklyUsage(org: Organization, store: Store): Promise<WeeklyUsageResult> {
  const periods = await getInventoryPeriods(org.id, store.id)

  if (periods.length > 0) {
    const recent = periods.slice(-USAGE_LOOKBACK_PERIODS)
    const totals = new Map<string, number>()
    let totalDays = 0
    for (const period of recent) {
      const spanDays = (period.end.finalizedAt.getTime() - period.begin.finalizedAt.getTime()) / 86_400_000
      if (spanDays <= 0) continue
      totalDays += spanDays
      const [begin, end, received, adjustments] = await Promise.all([
        countLineRollup(period.begin.countId),
        countLineRollup(period.end.countId),
        receivedLinesInWindow(org.id, store.id, period.begin.finalizedAt, period.end.finalizedAt),
        adjustmentRollupInWindow(org.id, store.id, period.begin.finalizedAt, period.end.finalizedAt),
      ])
      const purchased = new Map<string, number>()
      for (const l of received) {
        purchased.set(l.ingredientId, (purchased.get(l.ingredientId) ?? 0) + l.quantityReceived * l.unitsPerPurchase)
      }
      const ids = new Set<string>([...begin.keys(), ...end.keys(), ...purchased.keys()])
      for (const id of ids) {
        const used =
          (begin.get(id)?.qty ?? 0) +
          (purchased.get(id) ?? 0) +
          signedQtyAllTypes(adjustments.perIngredient.get(id)?.byType ?? {}) -
          (end.get(id)?.qty ?? 0)
        totals.set(id, (totals.get(id) ?? 0) + used)
      }
    }
    if (totalDays > 0) {
      const usage = new Map<string, number>()
      for (const [id, total] of totals) {
        // Negative period usage (miscounts) reads as 0/week, not negative demand.
        usage.set(id, Math.max(0, (total / totalDays) * 7))
      }
      return { usage, basis: "periods" }
    }
  }

  // Fallback: theoretical usage from synced sales over the recent window.
  const now = new Date()
  const end = localDateStr(now, store.timezone)
  const startDate = new Date(now.getTime() - (USAGE_LOOKBACK_DAYS - 1) * 86_400_000)
  const start = localDateStr(startDate, store.timezone)
  try {
    await ensureSalesCached(org, store, start, end)
  } catch {
    // degrade to whatever is cached
  }
  const cached = await prisma.salesPeriodCache.findMany({
    where: { storeId: store.id, date: { gte: dbDate(start), lte: dbDate(end) } },
    select: { date: true },
  })
  if (cached.length === 0) return { usage: new Map(), basis: "none" }

  const { usage: soldUsage } = await salesUsageForWindow(org, store.id, start, end)
  const usage = new Map<string, number>()
  for (const [id, total] of soldUsage) {
    usage.set(id, (total / cached.length) * 7)
  }
  return { usage, basis: "sales" }
}
