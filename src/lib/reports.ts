import { prisma } from "@/lib/prisma"

// ─── Shared reporting math (Phase I-5) ───────────────────────────────────────
// An INVENTORY PERIOD is the span between two consecutive FINALIZED, non-partial
// counts at one store. Usage $ = beginning + received purchases − ending.
// Cost % = usage / net sales. Sales days attributed to a period are the store-
// local dates AFTER the beginning count's date through the ending count's date
// (a count taken tonight closes today's period — today's sales belong to it).

export type PeriodBoundary = {
  countId: string
  name: string | null
  finalizedAt: Date
  value: number
}

export type InventoryPeriod = {
  begin: PeriodBoundary
  end: PeriodBoundary
}

function boundaryFromCount(c: {
  id: string
  name: string | null
  finalizedAt: Date | null
  sittingInventoryVal: number | null
}): PeriodBoundary {
  return {
    countId: c.id,
    name: c.name,
    finalizedAt: c.finalizedAt as Date,
    value: c.sittingInventoryVal ?? 0,
  }
}

// All periods for a store, oldest first. Partial counts NEVER form boundaries.
export async function getInventoryPeriods(organizationId: string, storeId: string): Promise<InventoryPeriod[]> {
  const counts = await prisma.inventoryCount.findMany({
    where: { organizationId, storeId, status: "Finalized", isPartial: false, finalizedAt: { not: null } },
    orderBy: { finalizedAt: "asc" },
    select: { id: true, name: true, finalizedAt: true, sittingInventoryVal: true },
  })
  const periods: InventoryPeriod[] = []
  for (let i = 0; i + 1 < counts.length; i++) {
    periods.push({ begin: boundaryFromCount(counts[i]), end: boundaryFromCount(counts[i + 1]) })
  }
  return periods
}

// Store-local yyyy-mm-dd of an instant.
export function localDateStr(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function dbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

export function nextDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// The store-local business day an instant falls on, as the UTC-midnight range
// convention used by Checklist.date. Never derive a checklist's "today" from
// server time — Vercel runs UTC, which flips to the next day at 5-6 PM local
// for US stores and misattributes evening shifts (the I-14 handoff-note bug).
export function businessDayWindow(instant: Date, timeZone: string): { day: string; gte: Date; lt: Date } {
  const day = localDateStr(instant, timeZone)
  return { day, gte: dbDate(day), lt: dbDate(nextDateStr(day)) }
}

// Sales-day window (inclusive, yyyy-mm-dd) attributed to a period.
export function periodSalesWindow(period: InventoryPeriod, timeZone: string): { start: string; end: string } {
  return {
    start: nextDateStr(localDateStr(period.begin.finalizedAt, timeZone)),
    end: localDateStr(period.end.finalizedAt, timeZone),
  }
}

// Net sales for a store across an inclusive local-date window.
export async function netSalesForWindow(storeId: string, start: string, end: string): Promise<number> {
  if (start > end) return 0
  const agg = await prisma.salesPeriodCache.aggregate({
    where: { storeId, date: { gte: dbDate(start), lte: dbDate(end) } },
    _sum: { netSales: true },
  })
  return agg._sum.netSales ?? 0
}

export type ReceivedLine = {
  ingredientId: string
  ingredientName: string
  value: number
  quantityReceived: number
  unitsPerPurchase: number
  vendorId: string
  vendorName: string
  orderedAt: Date | null
  receivedAt: Date
  glCode: string | null
  categoryName: string | null
}

// PO lines received at a store within (after, through] — the received value that
// belongs to that inventory period.
export async function receivedLinesInWindow(
  organizationId: string,
  storeId: string,
  after: Date,
  through: Date
): Promise<ReceivedLine[]> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      receivedAt: { gt: after, lte: through },
      quantityReceived: { gt: 0 },
      purchaseOrder: { organizationId, storeId },
    },
    include: {
      purchaseOrder: { include: { vendor: true } },
      ingredient: { include: { category: true } },
    },
  })
  return lines.map((l) => ({
    ingredientId: l.ingredientId,
    ingredientName: l.ingredientName,
    value: l.quantityReceived * l.unitCost,
    quantityReceived: l.quantityReceived,
    unitsPerPurchase: l.ingredient.unitsPerPurchase,
    vendorId: l.purchaseOrder.vendorId,
    vendorName: l.purchaseOrder.vendor.name,
    orderedAt: l.purchaseOrder.orderedAt,
    receivedAt: l.receivedAt as Date,
    glCode: l.ingredient.glCodeOverride ?? l.ingredient.category?.glCode ?? null,
    categoryName: l.ingredient.category?.name ?? null,
  }))
}

// ─── Adjustment rollups (Phase I-6) ──────────────────────────────────────────
// InventoryAdjustment.quantity/value are SIGNED stock effects (out = negative).
// Rows are bucketed by their backdatable occurredAt into (after, through].

export type AdjustmentTypeTotals = Partial<Record<string, { qty: number; value: number }>>

export type AdjustmentRollup = {
  /** signed totals per type across the window, e.g. TRANSFER_OUT.value < 0 */
  byType: AdjustmentTypeTotals
  /** per ingredient: signed qty/value per type */
  perIngredient: Map<string, { ingredientName: string; byType: AdjustmentTypeTotals }>
}

export async function adjustmentRollupInWindow(
  organizationId: string,
  storeId: string,
  after: Date,
  through: Date
): Promise<AdjustmentRollup> {
  const rows = await prisma.inventoryAdjustment.findMany({
    where: { organizationId, storeId, occurredAt: { gt: after, lte: through } },
  })
  const byType: AdjustmentTypeTotals = {}
  const perIngredient: AdjustmentRollup["perIngredient"] = new Map()
  for (const r of rows) {
    const t = (byType[r.type] ??= { qty: 0, value: 0 })
    t.qty += r.quantity
    t.value += r.value
    const ing = perIngredient.get(r.ingredientId) ?? { ingredientName: r.ingredientName, byType: {} }
    const it = (ing.byType[r.type] ??= { qty: 0, value: 0 })
    it.qty += r.quantity
    it.value += r.value
    perIngredient.set(r.ingredientId, ing)
  }
  return { byType, perIngredient }
}

// Sum of the signed values for the types that belong in the COGS usage
// equation: usage = beginning + purchases − ending − transfersOut + transfersIn
// (+ prep net ≈ 0 and corrections). WASTE/COMP stay inside usage and are
// reported separately.
export const USAGE_EQUATION_TYPES = ["TRANSFER_IN", "TRANSFER_OUT", "PREP_CONSUME", "PREP_PRODUCE", "CORRECTION"]

export function usageEquationAdjustmentValue(byType: AdjustmentTypeTotals): number {
  return USAGE_EQUATION_TYPES.reduce((s, t) => s + (byType[t]?.value ?? 0), 0)
}

export function signedQtyAllTypes(byType: AdjustmentTypeTotals): number {
  return Object.values(byType).reduce((s, t) => s + (t?.qty ?? 0), 0)
}

export type CountLineRollup = Map<
  string,
  {
    ingredientName: string
    qty: number
    value: number
    glCode: string | null
    categoryName: string | null
    reportingUnit: string
  }
>

// Per-ingredient totals (qty in reporting units + line value) for one count.
export async function countLineRollup(countId: string): Promise<CountLineRollup> {
  const lines = await prisma.inventoryCountLine.findMany({
    where: { inventoryCountId: countId },
    include: { ingredient: { include: { category: true } } },
  })
  const map: CountLineRollup = new Map()
  for (const l of lines) {
    const entry = map.get(l.ingredientId) ?? {
      ingredientName: l.ingredientName,
      qty: 0,
      value: 0,
      glCode: l.ingredient.glCodeOverride ?? l.ingredient.category?.glCode ?? null,
      categoryName: l.ingredient.category?.name ?? null,
      reportingUnit: l.reportingUnit,
    }
    entry.qty += l.quantityCounted ?? 0
    entry.value += l.lineValue ?? (l.quantityCounted ?? 0) * l.costPerReportingUnit
    map.set(l.ingredientId, entry)
  }
  return map
}
