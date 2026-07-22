import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyForecast } from "@/lib/labor-forecast"
import { resolveLaborSettings } from "@/lib/labor-settings"
import { computeWeeklyLaborBudget, type LaborBudgetResult } from "@/lib/labor-budget"
import {
  splitWeeklyHoursToDays,
  splitWeeklyHoursToDaysFloorFirst,
  applyDayAdjustment,
  capGmFloorCredits,
} from "@/lib/labor-daily"
import { computeDailyCoverage, type CoverageResult, type HourNet } from "@/lib/labor-coverage"

// L-3 shared weekly-plan engine. One place that turns a store's weekly labor
// budget into a per-DAY hourly-hours plan, so the Budget card, the Coverage
// card, and the Weekly Plan page all agree. It assembles engines that already
// exist (computeWeeklyLaborBudget, the day split, the coverage engine) and adds
// the two L-3 allocation corrections:
//   • FLOOR-FIRST split (default) — guarantee each open day its minimum floor
//     before distributing the remainder by sales weight (LaborSettings.
//     dailySplitPolicy; SALES_WEIGHTED restores the pre-L-3 behavior).
//   • GM 40h weekly cap — the salaried GM's counted floor coverage is capped at
//     40h/week (capGmFloorCredits) so the floor math can't lean on hours the GM
//     doesn't work.
// It also applies the L-3B per-date WeeklyDayHours overrides on top of the
// split (rebalancing), constrained to the weekly hourly total.

const WEEKLY_GM_CAP_HOURS = 40

// ── date / hour helpers ───────────────────────────────────────────────────────
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export function jsDowOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay() // 0 Sun..6 Sat
}
export function laborWeekdayOf(dateStr: string): number {
  return (jsDowOf(dateStr) + 6) % 7 // 0 Mon..6 Sun
}
export function parseHourStart(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.floor(Number(m[1]) + Number(m[2]) / 60) : null
}
export function parseHourEnd(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.ceil(Number(m[1]) + Number(m[2]) / 60) : null
}

export type DayPlan = {
  date: string // yyyy-mm-dd
  weekday: number // 0 = Mon … 6 = Sun
  open: { startHour: number; endHour: number } | null
  openHours: number
  gmWindow: { startHour: number; endHour: number } | null // full window (rendered as-is; the cap is a floor-math correction, not a per-day trim — see L-3/L-4 seam below)
  gmCreditHours: number // GM floor credit AFTER the 40h weekly cap
  floorHours: number // max(0, openHours − gmCreditHours)
  baseHourlyHours: number // floor-first (or sales-weighted) split, pre-override
  overrideHours: number | null // L-3B per-date rebalance override, if set
  splitHourlyHours: number // overrideHours ?? baseHourlyHours (pre-adjustment)
  adjustmentPct: number
  adjustmentReason: string | null
  hourlyHours: number // final = applyDayAdjustment(splitHourlyHours, adjustmentPct)
}

export type WeeklyPlan = {
  weekStart: string
  policy: "FLOOR_FIRST" | "SALES_WEIGHTED"
  hasForecast: boolean
  forecast: { total: number; source: "MANUAL" | "TREND" } | null
  budget: LaborBudgetResult | null
  target: number
  hasGm: boolean
  hasHourlySupervisor: boolean
  days: DayPlan[] // length 7, Mon…Sun
  weeklyHourlyHours: number // budget.hourlyHours (the pool the split distributes)
  weeklyHourlyAllocated: number // Σ baseHourlyHours (≈ pool, minus 0.5 flooring)
  adjustedTotalSchedulableHours: number // salaried + Σ final hourlyHours
  overrideTotal: number | null // Σ overrideHours if any exist, else null
}

// Build the whole week's per-day hours plan for a store. `anyDateInWeek` snaps
// to Monday. No auth here — callers gate via labor-access.
export async function getWeeklyDayPlan(storeId: string, anyDateInWeek: string): Promise<WeeklyPlan> {
  const weekStart = mondayOfWeekStr(anyDateInWeek)
  const weekEnd = addDaysStr(weekStart, 6)
  const dates = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)) // Mon…Sun

  // Need organizationId for the settings resolve + position query.
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { organizationId: true } })
  const organizationId = store?.organizationId ?? ""

  const [settings, positions, forecast, splitRows, adjRows, overrideRows, storeHoursRows] = await Promise.all([
    resolveLaborSettings(organizationId, storeId),
    prisma.laborPosition.findMany({ where: { organizationId, active: true } }),
    getWeeklyForecast(storeId, weekStart),
    prisma.laborDaySplit.findMany({ where: { storeId } }),
    prisma.laborDayAdjustment.findMany({ where: { storeId, date: { gte: dbDate(weekStart), lte: dbDate(weekEnd) } } }),
    prisma.weeklyDayHours.findMany({ where: { storeId, weekStart: dbDate(weekStart) } }),
    prisma.storeHours.findMany({ where: { storeId } }),
  ])

  const budget = computeWeeklyLaborBudget({
    settings,
    positions: positions.map((p) => ({ payType: p.payType, defaultHourlyRate: Number(p.defaultHourlyRate), impliedWeeklyHours: p.impliedWeeklyHours, active: p.active })),
    forecast: forecast ? { total: forecast.total } : null,
  })

  const hasGm = positions.some((p) => p.payType === "SALARIED")
  const hasHourlySupervisor = positions.some((p) => p.isSupervisory && p.payType === "HOURLY")
  const target = settings.laborTargetPct

  // Per-day open window + GM window (uncapped).
  const openByDay = new Array(7).fill(null) as ({ startHour: number; endHour: number } | null)[]
  const gmWindowByDay = new Array(7).fill(null) as ({ startHour: number; endHour: number } | null)[]
  const gmHoursByDay = new Array(7).fill(0) as number[]
  const openHoursByDay = new Array(7).fill(0) as number[]

  for (let wd = 0; wd < 7; wd++) {
    const jsDow = jsDowOf(dates[wd])
    const sh = storeHoursRows.find((r) => r.dayOfWeek === jsDow)
    let open: { startHour: number; endHour: number } | null = null
    if (sh && !sh.isClosed) {
      const s = parseHourStart(sh.openingTime)
      const e = parseHourEnd(sh.closingTime)
      if (s != null && e != null && e > s) open = { startHour: s, endHour: e }
    }
    openByDay[wd] = open
    openHoursByDay[wd] = open ? open.endHour - open.startHour : 0

    if (hasGm && open) {
      const gmStart = settings.gmOnFloorStartMinutes != null ? Math.floor(settings.gmOnFloorStartMinutes / 60) : open.startHour
      const gmEnd = settings.gmOnFloorEndMinutes != null ? Math.ceil(settings.gmOnFloorEndMinutes / 60) : 14
      if (gmEnd > gmStart) {
        gmWindowByDay[wd] = { startHour: gmStart, endHour: gmEnd }
        // GM on-floor hours that actually overlap the open window.
        gmHoursByDay[wd] = Math.max(0, Math.min(gmEnd, open.endHour) - Math.max(gmStart, open.startHour))
      }
    }
  }

  // GM 40h weekly cap → per-day credited floor hours.
  const gmCreditByDay = capGmFloorCredits(gmHoursByDay, WEEKLY_GM_CAP_HOURS)
  const floorByDay = openHoursByDay.map((oh, wd) => Math.max(0, oh - gmCreditByDay[wd]))

  const weightsByWeekday = splitRows.length > 0 ? Array.from({ length: 7 }, (_, wd) => splitRows.find((r) => r.weekday === wd)?.weightBps ?? 0) : null

  const weeklyHourly = budget?.hourlyHours ?? 0

  // L-3B overrides: pin overridden days, split the REMAINING pool across the
  // non-overridden days (floor-first or sales-weighted) so the week still sums
  // to the weekly hourly total.
  const overrideByWeekday = new Array(7).fill(null) as (number | null)[]
  for (const o of overrideRows) {
    overrideByWeekday[laborWeekdayOf(o.date.toISOString().slice(0, 10))] = Number(o.hoursOverride)
  }
  const hasOverrides = overrideByWeekday.some((v) => v != null)
  const overrideSum = overrideByWeekday.reduce<number>((s, v) => s + (v ?? 0), 0)
  const poolForSplit = hasOverrides ? Math.max(0, weeklyHourly - overrideSum) : weeklyHourly

  // Zero out overridden days so the split neither reserves their floor nor gives
  // them remainder — they take their pinned override instead.
  const floorForSplit = floorByDay.map((f, wd) => (overrideByWeekday[wd] != null ? 0 : f))

  const baseSplit =
    settings.dailySplitPolicy === "SALES_WEIGHTED"
      ? splitWeeklyHoursToDays({ weeklyHourlyHours: poolForSplit, weightsByWeekday, openDays: floorForSplit.map((f, wd) => (f > 0 ? wd : -1)).filter((wd) => wd >= 0) })
      : splitWeeklyHoursToDaysFloorFirst({ weeklyHourlyHours: poolForSplit, weightsByWeekday, floorHoursByWeekday: floorForSplit })

  const adjByWeekday = new Map<number, { pct: number; reason: string | null }>()
  for (const a of adjRows) {
    adjByWeekday.set(laborWeekdayOf(a.date.toISOString().slice(0, 10)), { pct: Number(a.adjustmentPct), reason: a.reason })
  }

  const days: DayPlan[] = dates.map((date, wd) => {
    const base = baseSplit.find((d) => d.weekday === wd)?.hourlyHours ?? 0
    const override = overrideByWeekday[wd]
    const split = override != null ? override : base
    const adj = adjByWeekday.get(wd)
    const adjustmentPct = adj?.pct ?? 0
    return {
      date,
      weekday: wd,
      open: openByDay[wd],
      openHours: openHoursByDay[wd],
      gmWindow: gmWindowByDay[wd],
      gmCreditHours: +gmCreditByDay[wd].toFixed(2),
      floorHours: +floorByDay[wd].toFixed(2),
      baseHourlyHours: base,
      overrideHours: override,
      splitHourlyHours: split,
      adjustmentPct,
      adjustmentReason: adj?.reason ?? null,
      hourlyHours: applyDayAdjustment(split, adjustmentPct),
    }
  })

  const weeklyHourlyAllocated = +days.reduce((s, d) => s + (d.overrideHours ?? d.baseHourlyHours), 0).toFixed(1)
  const adjustedTotalSchedulableHours = +((budget?.salariedHours ?? 0) + days.reduce((s, d) => s + d.hourlyHours, 0)).toFixed(1)

  return {
    weekStart,
    policy: settings.dailySplitPolicy,
    hasForecast: !!budget,
    forecast: forecast ? { total: forecast.total, source: forecast.source } : null,
    budget,
    target,
    hasGm,
    hasHourlySupervisor,
    days,
    weeklyHourlyHours: weeklyHourly,
    weeklyHourlyAllocated,
    adjustedTotalSchedulableHours,
    overrideTotal: hasOverrides ? +overrideSum.toFixed(1) : null,
  }
}

// The day's hourly demand shape. Past/today with data → that day's actuals;
// otherwise (future or a gap) the average of the same weekday over the last 4
// weeks (dates ≤ today). Moved here from the coverage route so the Weekly Plan
// page reuses the exact same shape. `today` is store-local yyyy-mm-dd.
export async function getDemandShape(storeId: string, date: string, today: string): Promise<HourNet[]> {
  if (date <= today) {
    const rows = await prisma.salesHourlyCache.findMany({ where: { storeId, date: dbDate(date) }, orderBy: { hour: "asc" } })
    if (rows.length > 0) return rows.map((r) => ({ hour: r.hour, net: r.netSales }))
  }
  const targetWd = jsDowOf(date)
  let cursor = today
  for (let i = 0; i < 7 && jsDowOf(cursor) !== targetWd; i++) cursor = addDaysStr(cursor, -1)
  const dates = [0, 7, 14, 21].map((k) => addDaysStr(cursor, -k))
  const rows = await prisma.salesHourlyCache.findMany({ where: { storeId, date: { in: dates.map((d) => dbDate(d)) } } })
  if (rows.length === 0) return []
  const sum = new Map<number, number>()
  const seenDays = new Set<string>()
  for (const r of rows) {
    sum.set(r.hour, (sum.get(r.hour) ?? 0) + r.netSales)
    seenDays.add(r.date.toISOString().slice(0, 10))
  }
  const nDays = Math.max(1, seenDays.size)
  return [...sum.entries()].map(([hour, total]) => ({ hour, net: total / nDays })).sort((a, b) => a.hour - b.hour)
}

// Run the (unchanged) coverage engine for a single day of a plan. The GM band is
// rendered from the FULL day window — the 40h cap is applied only to the split's
// floor math (in getWeeklyDayPlan), never by trimming which hours the GM works.
// Which specific days/hours the GM is off is the assignment layer (L-4).
export async function computeDayCoverage(storeId: string, day: DayPlan, today: string, hasHourlySupervisor: boolean): Promise<CoverageResult | null> {
  const demand = await getDemandShape(storeId, day.date, today)
  return computeDailyCoverage({
    hourlyBudgetHours: day.hourlyHours,
    demand,
    open: day.open,
    gmWindow: day.gmWindow,
    hasHourlySupervisor,
  })
}
