import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr, dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyDayPlan, computeDayCoverage, addDaysStr } from "@/lib/labor-plan"
import { suggestedHoursForDay } from "@/lib/labor-coverage"
import { can } from "@/lib/permissions"
import { getScheduleSyncSummary, getScheduledHoursByDay } from "@/lib/labor-schedule"

// GET /api/labor/weekly-plan?storeId=&weekStart= — the Weekly Plan week strip
// (Layer 1). Assembles the shared L-3 day plan (floor-first split + GM cap +
// rebalance overrides) with per-day forecast sales, last-year same-weekday
// actuals, allocated hours, projected labor %, weather chips, and a coverage
// status. The selected-day detail (Layer 2) is the existing /api/labor/coverage
// endpoint. Read-only, any role that can see the store.
//
// OVL-S4 — THE COMPARISON RIDES BESIDE `days`, NEVER INSIDE IT. Scheduled-vs-
// suggested is a DISPLAY comparison (seam (b)): both halves are read after the
// plan has already been computed, and neither is an input to the budget, the
// demand shape or the recommendation. Delete the `comparison` key and this
// route's plan is byte-identical to what it served before this session.
//
// ABSENCE, NOT EMPTINESS. Without labor.schedule.view there is NO `comparison`
// key at all — not an empty object, not nulls — exactly as /api/labor/coverage
// omits `overlay`. A payload that never carries the data cannot leak it.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type DayStatus = "closed" | "under" | "tight" | "slack" | "ok"

// Status is derived from the SAME coverage engine the day-detail renders, so the
// strip and the detail always agree. `used` = hourly person-hours the recommended
// coverage actually needs (demand-shaped + floor-of-1); `budget` = what's
// allocated to the day.
//   under  = coverage can't fit the floor within budget (used > budget)
//   tight  = coverage spends essentially all of the budget (little cushion)
//   slack  = budget noticeably exceeds what the day needs (room to rebalance out)
//   ok     = comfortable middle
function dayStatus(open: boolean, cov: { understaffedBudget: boolean; usedHourlyHours: number; hourlyBudgetHours: number } | null): DayStatus {
  if (!open) return "closed"
  if (!cov) return "ok"
  if (cov.understaffedBudget) return "under"
  if (cov.hourlyBudgetHours > 0 && cov.usedHourlyHours <= cov.hourlyBudgetHours * 0.8) return "slack"
  if (cov.usedHourlyHours >= cov.hourlyBudgetHours - 0.5) return "tight"
  return "ok"
}

export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const weekStartParam = url.searchParams.get("weekStart")
  const weekStart = mondayOfWeekStr(weekStartParam && DATE_RE.test(weekStartParam) ? weekStartParam : today)
  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"

  const plan = await getWeeklyDayPlan(storeId, weekStart, today)
  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, weekStart, canManage, policy: plan.policy, target: plan.target }

  if (!plan.budget) {
    return NextResponse.json({ ...base, hasForecast: false, weekly: null, days: [] })
  }

  const dates = plan.days.map((d) => d.date)
  const lastYearDates = dates.map((d) => addDaysStr(d, -364)) // same weekday, one year prior

  const [dailyGoals, lastYearSales] = await Promise.all([
    prisma.dailyGoal.findMany({ where: { storeId, date: { in: dates.map((d) => dbDate(d)) } }, select: { date: true, goalAmount: true } }),
    prisma.salesPeriodCache.findMany({ where: { storeId, date: { in: lastYearDates.map((d) => dbDate(d)) } }, select: { date: true, netSales: true } }),
  ])
  const goalByDate = new Map(dailyGoals.map((g) => [g.date.toISOString().slice(0, 10), g.goalAmount]))
  const lastYearByDate = new Map(lastYearSales.map((s) => [s.date.toISOString().slice(0, 10), s.netSales]))

  const blendedRate = plan.budget.blendedHourlyRate
  const salariedCost = plan.budget.salariedCost
  const weekForecastSum = dates.reduce((s, d) => s + (goalByDate.get(d) ?? 0), 0)

  // Per-day coverage from the same engine the detail renders → consistent status.
  const covByDay = await Promise.all(plan.days.map((d) => computeDayCoverage(storeId, d, today, plan.hasHourlySupervisor)))

  const days = plan.days.map((d, i) => {
    const forecastSales = goalByDate.get(d.date) ?? null
    const lastYear = lastYearByDate.get(lastYearDates[i]) ?? null
    const lastYearDelta = forecastSales != null && lastYear != null ? +(forecastSales - lastYear).toFixed(2) : null
    // Per-day labor cost: hourly $ + a share of the weekly salaried cost,
    // attributed by the day's share of the week's forecast (busy days carry more
    // of the fixed cost; Σ day costs = the weekly labor total).
    const salariedShare = weekForecastSum > 0 && forecastSales != null ? salariedCost * (forecastSales / weekForecastSum) : 0
    const dayLaborCost = d.hourlyHours * blendedRate + salariedShare
    const projectedLaborPct = forecastSales && forecastSales > 0 ? +((dayLaborCost / forecastSales) * 100).toFixed(1) : null
    return {
      date: d.date,
      weekday: d.weekday,
      isToday: d.date === today,
      isPast: d.date < today,
      closed: !d.open,
      open: d.open,
      forecastSales,
      lastYearSales: lastYear,
      lastYearDelta,
      hoursAllocated: d.hourlyHours,
      floorHours: d.floorHours,
      baseHourlyHours: d.baseHourlyHours,
      overrideHours: d.overrideHours,
      splitHourlyHours: d.splitHourlyHours,
      adjustmentPct: d.adjustmentPct,
      adjustmentReason: d.adjustmentReason,
      gmWindow: d.gmWindow,
      status: dayStatus(!!d.open, covByDay[i]),
    }
  })

  const comparison = can(ctx.actor, "labor.schedule.view")
    ? await buildComparison(storeId, dates, covByDay, plan.days.map((d) => d.gmCreditHours))
    : undefined

  return NextResponse.json({
    ...base,
    hasForecast: true,
    // `undefined` is dropped by JSON.stringify — the key is genuinely absent.
    ...(comparison ? { comparison } : {}),
    weekly: {
      forecastTotal: plan.forecast?.total ?? null,
      forecastSource: plan.forecast?.source ?? null,
      hourlyHours: plan.weeklyHourlyHours,
      salariedHours: plan.budget.salariedHours,
      totalSchedulableHours: plan.budget.totalSchedulableHours,
      adjustedTotalSchedulableHours: plan.adjustedTotalSchedulableHours,
      projectedLaborPctAtForecast: plan.budget.projectedLaborPctAtForecast,
      floorExceedsBudget: plan.budget.floorExceedsBudget,
      // R7-C leaf — a banner input, never an arithmetic one.
      hasIncompleteAllocation: plan.hasIncompleteAllocation,
      incompleteAllocationPeople: plan.incompleteAllocationPeople,
      overrideTotal: plan.overrideTotal,
    },
    days,
  })
}

/// Assembles the scheduled-vs-suggested comparison. TWO READS, AND NEITHER
/// RE-COMPUTES THE RECOMMENDATION: `covByDay` is the coverage the route already
/// ran for the week strip's status, so the suggested half costs nothing beyond a
/// sum, and the scheduled half is a single mirrored-row query.
async function buildComparison(
  storeId: string,
  dates: string[],
  covByDay: (Awaited<ReturnType<typeof computeDayCoverage>>)[],
  // The manager's CREDITED hours per day, positionally aligned with `dates` —
  // `DayPlan.gmCreditHours`, already capped to her allocation by
  // capGmFloorCredits. Zero at every store with no allocated person.
  gmCreditByDay: number[]
) {
  const sync = await getScheduleSyncSummary(storeId)

  // SUGGESTED HOURS COUNT THE WHOLE CREW INCLUDING THE MANAGER — the 2026-08-20
  // ruling stands, and `usedHourlyHours` is still the wrong number here because it
  // excludes her and a Square schedule does not.
  //
  // WHAT CHANGED 2026-08-23 IS THE INSTRUMENT, NOT THE POLICY. This used to be
  // Σ headcount, which counted ONE MANAGER BODY PER DRAWN BAND HOUR — at the unset
  // default that is ~6-7 hours a day across SEVEN days, for a person who works
  // five. It now reads her CREDITED hours for the day, which are derived from her
  // allocation and already capped to it. Froot knows she is worth 20 hours a week
  // at each of two stores; it does not know WHICH 20, and that is L-4.
  //
  // A day with no shape at all is null rather than 0 — no forecast is not a
  // recommendation of nobody.
  const suggested = dates.map((_, i) => {
    const cov = covByDay[i]
    if (!cov) return null
    return +suggestedHoursForDay(cov.points, gmCreditByDay[i] ?? 0).toFixed(2)
  })

  // NEVER-SYNCED READS NOTHING. Seam (c): a store we have never asked about must
  // not have a scheduled column at all, and the client renders no section — the
  // same fall-through the card makes.
  const hoursByDate = sync.health === "never" ? null : await getScheduledHoursByDay(storeId, dates)

  // SYNCED-EMPTY IS SUGGESTED-ONLY, NOT A COLUMN OF ZEROS. We asked and Square
  // said nothing; "0.0 hrs scheduled" would present that silence as a staffing
  // decision somebody made. The card says so in words and so does this.
  const scheduledIsReal = hoursByDate !== null && sync.health !== "synced-empty"

  return {
    sync,
    days: dates.map((date, i) => ({
      date,
      suggestedHours: suggested[i],
      scheduledHours: scheduledIsReal ? hoursByDate[date] ?? 0 : null,
    })),
  }
}
