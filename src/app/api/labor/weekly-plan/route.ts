import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr, dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyDayPlan, addDaysStr } from "@/lib/labor-plan"

// GET /api/labor/weekly-plan?storeId=&weekStart= — the Weekly Plan week strip
// (Layer 1). Assembles the shared L-3 day plan (floor-first split + GM cap +
// rebalance overrides) with per-day forecast sales, last-year same-weekday
// actuals, allocated hours, projected labor %, weather chips, and a coverage
// status. The selected-day detail (Layer 2) is the existing /api/labor/coverage
// endpoint. Read-only, any role that can see the store.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type DayStatus = "closed" | "under" | "tight" | "slack" | "ok"

function dayStatus(open: boolean, floorHours: number, allocated: number): DayStatus {
  if (!open) return "closed"
  if (floorHours > 0 && allocated < floorHours - 0.5) return "under"
  if (floorHours > 0 && allocated <= floorHours + 1) return "tight"
  if (floorHours > 0 && allocated >= floorHours * 2) return "slack"
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
      status: dayStatus(!!d.open, d.floorHours, d.hourlyHours),
    }
  })

  return NextResponse.json({
    ...base,
    hasForecast: true,
    weekly: {
      forecastTotal: plan.forecast?.total ?? null,
      forecastSource: plan.forecast?.source ?? null,
      hourlyHours: plan.weeklyHourlyHours,
      salariedHours: plan.budget.salariedHours,
      totalSchedulableHours: plan.budget.totalSchedulableHours,
      adjustedTotalSchedulableHours: plan.adjustedTotalSchedulableHours,
      projectedLaborPctAtForecast: plan.budget.projectedLaborPctAtForecast,
      floorExceedsBudget: plan.budget.floorExceedsBudget,
      overrideTotal: plan.overrideTotal,
    },
    days,
  })
}
