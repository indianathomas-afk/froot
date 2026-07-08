import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import type { GoalBasisType, Prisma } from "@prisma/client"

// ─── Goal engine (Phase F) ────────────────────────────────────────────────────
// Builds per-day sales goals for a store-year. Basis = last year's Square
// sales (weekday-aligned: date − 364 days, so Tuesdays compare to Tuesdays),
// an imported file, or manual entry. goalAmount = basis × (1 + increasePct/100)
// rounded to cents, with each month's rounding drift pushed onto its last
// regenerated day so month totals match the scaled month basis exactly.

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function yearDates(year: number): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(year, 0, 1))
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// The LY window that weekday-aligned basis dates for `year` can fall into,
// plus the full calendar prior year (same-calendar-date fallback lives there).
export function basisWindow(year: number): { start: string; end: string } {
  return { start: addDaysStr(`${year}-01-01`, -364), end: addDaysStr(`${year}-12-31`, -364) }
}

// Same calendar date one year earlier; Feb 29 falls back to Feb 28.
function sameCalendarDateLastYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-")
  if (m === "02" && d === "29") return `${Number(y) - 1}-02-28`
  return `${Number(y) - 1}-${m}-${d}`
}

export type BasisCoverage = {
  basisByDay: Map<string, number>
  basisTotal: number
  totalDays: number
  alignedDays: number // basis came from date − 364
  fallbackDays: number // same-calendar-date or weekday-average fallback
  uncoveredDays: number // no LY data at all → basis 0
}

// Weekday-aligned basis for every day of `year` from SalesPeriodCache.
// Priority per day D: sales on D−364 → sales on same calendar date last year →
// average of that weekday in the month of D−364 → 0.
export async function buildLastYearBasis(storeId: string, year: number): Promise<BasisCoverage> {
  const win = basisWindow(year)
  const fetchStart = win.start < `${year - 1}-01-01` ? win.start : `${year - 1}-01-01`
  const rows = await prisma.salesPeriodCache.findMany({
    where: { storeId, date: { gte: dbDate(fetchStart), lte: dbDate(win.end) } },
    select: { date: true, netSales: true },
  })
  const ly = new Map<string, number>()
  for (const r of rows) ly.set(r.date.toISOString().slice(0, 10), r.netSales)

  // Weekday averages per LY month, for dates the −364 shift can't cover.
  const weekdayAvg = new Map<string, number>() // `${yyyy-mm}|${weekday}` → avg net
  {
    const sums = new Map<string, { total: number; n: number }>()
    for (const [dateStr, net] of ly) {
      const wd = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()
      const key = `${dateStr.slice(0, 7)}|${wd}`
      const s = sums.get(key) ?? { total: 0, n: 0 }
      s.total += net
      s.n += 1
      sums.set(key, s)
    }
    for (const [key, s] of sums) weekdayAvg.set(key, s.total / s.n)
  }

  const basisByDay = new Map<string, number>()
  let alignedDays = 0
  let fallbackDays = 0
  let uncoveredDays = 0

  for (const dateStr of yearDates(year)) {
    const aligned = addDaysStr(dateStr, -364)
    if (ly.has(aligned)) {
      basisByDay.set(dateStr, round2(ly.get(aligned)!))
      alignedDays += 1
      continue
    }
    const sameDate = sameCalendarDateLastYear(dateStr)
    if (ly.has(sameDate)) {
      basisByDay.set(dateStr, round2(ly.get(sameDate)!))
      fallbackDays += 1
      continue
    }
    const wd = new Date(`${aligned}T00:00:00.000Z`).getUTCDay()
    const avg = weekdayAvg.get(`${aligned.slice(0, 7)}|${wd}`)
    if (avg !== undefined) {
      basisByDay.set(dateStr, round2(avg))
      fallbackDays += 1
    } else {
      basisByDay.set(dateStr, 0)
      uncoveredDays += 1
    }
  }

  let basisTotal = 0
  for (const v of basisByDay.values()) basisTotal += v
  return {
    basisByDay,
    basisTotal: round2(basisTotal),
    totalDays: basisByDay.size,
    alignedDays,
    fallbackDays,
    uncoveredDays,
  }
}

// Scale a set of days (all in one month) and pin the month's rounding drift on
// the last day so the month total equals round2(monthBasis × factor) exactly.
function scaleMonth(dates: string[], basisByDay: Map<string, number>, factor: number): Map<string, number> {
  const goals = new Map<string, number>()
  let monthBasis = 0
  let scaledSum = 0
  for (const d of dates) {
    const b = basisByDay.get(d) ?? 0
    monthBasis += b
    const g = round2(b * factor)
    goals.set(d, g)
    scaledSum += g
  }
  const target = round2(monthBasis * factor)
  const residual = round2(target - scaledSum)
  if (residual !== 0 && dates.length > 0) {
    const last = dates[dates.length - 1]
    goals.set(last, Math.max(0, round2((goals.get(last) ?? 0) + residual)))
  }
  return goals
}

export type RegenerateOptions = {
  organizationId: string
  storeId: string
  year: number
  basisType: GoalBasisType
  increasePct: number
  basisByDay: Map<string, number>
  updatedById: string
  importFileUrl?: string | null
  // Preserve manually-overridden days (default). false = full reset.
  preserveOverrides?: boolean
  // Only regenerate days on/after this date (mid-year % raise) — earlier days
  // keep the goals their actuals were measured against.
  fromDate?: string
}

// Create or fully rebuild a plan's DailyGoal rows in one transaction.
export async function regeneratePlan(opts: RegenerateOptions) {
  const {
    organizationId,
    storeId,
    year,
    basisType,
    increasePct,
    basisByDay,
    updatedById,
    importFileUrl,
    preserveOverrides = true,
    fromDate,
  } = opts
  const factor = 1 + increasePct / 100
  const allDates = yearDates(year)
  const yearStart = dbDate(`${year}-01-01`)
  const yearEnd = dbDate(`${year}-12-31`)

  return prisma.$transaction(async (tx) => {
    const plan = await tx.goalPlan.upsert({
      where: { storeId_year: { storeId, year } },
      create: { organizationId, storeId, year, basisType, increasePct, updatedById, importFileUrl: importFileUrl ?? null },
      update: { basisType, increasePct, updatedById, ...(importFileUrl !== undefined ? { importFileUrl } : {}) },
    })

    const existing = await tx.dailyGoal.findMany({
      where: { storeId, date: { gte: yearStart, lte: yearEnd } },
    })
    const existingByDate = new Map(existing.map((r) => [r.date.toISOString().slice(0, 10), r]))

    const isKept = (dateStr: string) => {
      const row = existingByDate.get(dateStr)
      if (!row) return false
      if (fromDate && dateStr < fromDate) return true
      return preserveOverrides && row.isOverride
    }

    // Scale month by month over the regenerable days only, so kept days
    // (overrides / frozen past) are untouched and never absorb residuals.
    const goalsByDate = new Map<string, number>()
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0")
      const monthDates = allDates.filter((d) => d.slice(5, 7) === mm && !isKept(d))
      const scaled = scaleMonth(monthDates, basisByDay, factor)
      for (const [d, g] of scaled) goalsByDate.set(d, g)
    }

    const regenDates = [...goalsByDate.keys()]
    await tx.dailyGoal.deleteMany({ where: { storeId, date: { in: regenDates.map(dbDate) } } })
    await tx.dailyGoal.createMany({
      data: regenDates.map((dateStr) => ({
        planId: plan.id,
        storeId,
        date: dbDate(dateStr),
        basisAmount: basisByDay.get(dateStr) ?? 0,
        goalAmount: goalsByDate.get(dateStr)!,
        isOverride: false,
      })),
    })
    // Kept rows created under an older plan row keep working — but re-point
    // them if the plan id changed (it can't with upsert, so this is a no-op
    // kept for clarity) and make sure their planId is this plan.
    await tx.dailyGoal.updateMany({
      where: { storeId, date: { gte: yearStart, lte: yearEnd }, planId: { not: plan.id } },
      data: { planId: plan.id },
    })

    return refreshPlanTotals(tx, plan.id)
  })
}

// Distribute a new month total across the month's days, weighted by each day's
// basis (falling back to current goals, then even). Marks days as overrides so
// later % recalcs preserve them; rounding drift lands on the last day.
export async function redistributeMonth(planId: string, storeId: string, monthStr: string, totalAmount: number) {
  const [y, m] = monthStr.split("-").map(Number)
  const first = dbDate(`${monthStr}-01`)
  const last = dbDate(`${monthStr}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`)

  return prisma.$transaction(async (tx) => {
    const days = await tx.dailyGoal.findMany({
      where: { planId, storeId, date: { gte: first, lte: last } },
      orderBy: { date: "asc" },
    })
    if (days.length === 0) throw new Error("NO_DAYS_IN_MONTH")

    const basisSum = days.reduce((s, d) => s + d.basisAmount, 0)
    const goalSum = days.reduce((s, d) => s + d.goalAmount, 0)
    const weights = days.map((d) => (basisSum > 0 ? d.basisAmount : goalSum > 0 ? d.goalAmount : 1))
    const weightSum = weights.reduce((s, w) => s + w, 0)

    let allocated = 0
    const amounts = days.map((_, i) => {
      const amt = round2((totalAmount * weights[i]) / weightSum)
      allocated += amt
      return amt
    })
    const residual = round2(totalAmount - allocated)
    if (residual !== 0) {
      amounts[amounts.length - 1] = Math.max(0, round2(amounts[amounts.length - 1] + residual))
    }

    for (let i = 0; i < days.length; i++) {
      await tx.dailyGoal.update({
        where: { id: days[i].id },
        data: { goalAmount: amounts[i], isOverride: true },
      })
    }
    return refreshPlanTotals(tx, planId)
  })
}

// Recompute the denormalized basisTotal/goalTotal from the daily rows.
export async function refreshPlanTotals(tx: Prisma.TransactionClient, planId: string) {
  const agg = await tx.dailyGoal.aggregate({
    where: { planId },
    _sum: { basisAmount: true, goalAmount: true },
  })
  return tx.goalPlan.update({
    where: { id: planId },
    data: {
      basisTotal: round2(agg._sum.basisAmount ?? 0),
      goalTotal: round2(agg._sum.goalAmount ?? 0),
    },
  })
}

// Spread month totals (e.g. a monthly-shape import) onto days using LY weekday
// weights when available, even split otherwise.
export function distributeMonthlyTotals(
  year: number,
  monthTotals: Map<string, number>, // "yyyy-mm" → amount
  lyBasis: Map<string, number> | null
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [monthStr, total] of monthTotals) {
    const dates = yearDates(year).filter((d) => d.slice(0, 7) === monthStr)
    if (dates.length === 0) continue
    const weights = dates.map((d) => lyBasis?.get(d) ?? 0)
    const weightSum = weights.reduce((s, w) => s + w, 0)
    let allocated = 0
    dates.forEach((d, i) => {
      const w = weightSum > 0 ? weights[i] / weightSum : 1 / dates.length
      const amt = round2(total * w)
      out.set(d, amt)
      allocated += amt
    })
    const residual = round2(total - allocated)
    if (residual !== 0) {
      const last = dates[dates.length - 1]
      out.set(last, Math.max(0, round2((out.get(last) ?? 0) + residual)))
    }
  }
  return out
}
