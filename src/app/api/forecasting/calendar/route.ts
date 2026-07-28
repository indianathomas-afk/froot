import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireForecastContext, requireForecastStore, forecastWindowForStore } from "@/lib/forecasting-access"
import { isDateInWindow } from "@/lib/forecast-window"
import { dbDate, localDateStr } from "@/lib/reports"

// GET /api/forecasting/calendar?storeId=&year= — one indexed read of the
// materialized DailyGoal rows joined with cached actuals (SalesPeriodCache).
// Square is never called here.
export async function GET(req: Request) {
  const ctx = await requireForecastContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const year = Number(url.searchParams.get("year"))
  if (!storeId || !Number.isInteger(year)) {
    return NextResponse.json({ error: "storeId and year are required" }, { status: 400 })
  }
  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  const start = dbDate(`${year}-01-01`)
  const end = dbDate(`${year}-12-31`)
  const today = localDateStr(new Date(), store.timezone)

  const [plan, goals, actuals] = await Promise.all([
    prisma.goalPlan.findUnique({ where: { storeId_year: { storeId, year } } }),
    prisma.dailyGoal.findMany({
      where: { storeId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      select: { date: true, basisAmount: true, goalAmount: true, isOverride: true },
    }),
    prisma.salesPeriodCache.findMany({
      where: { storeId, date: { gte: start, lte: end } },
      select: { date: true, netSales: true },
    }),
  ])

  const actualByDate = new Map(actuals.map((a) => [a.date.toISOString().slice(0, 10), a.netSales]))

  // PERM-3: managers see forecast GOALS only inside their window. The window is
  // applied per FIELD, not by clamping the requested range — clamping would
  // also withhold the historical ACTUALS a manager is entitled to (last July's
  // sales are how you budget this July), and rejecting the request outright
  // would reintroduce the PERM-2 "page renders while its API 403s" bug class.
  // basis and actual are deliberately left intact; the annual plan header stays
  // visible too (Gary, 2026-07-26).
  const win = forecastWindowForStore(ctx, store)

  return NextResponse.json({
    plan: plan
      ? {
          id: plan.id,
          basisType: plan.basisType,
          basisTotal: plan.basisTotal,
          increasePct: plan.increasePct,
          goalTotal: plan.goalTotal,
        }
      : null,
    today,
    canEdit: ctx.canEdit,
    // Lets the client explain blanked goals instead of looking broken.
    window: win ? { start: win.start, end: win.end } : null,
    days: goals.map((g) => {
      const dateStr = g.date.toISOString().slice(0, 10)
      const goalVisible = !win || isDateInWindow(dateStr, win)
      return {
        date: dateStr,
        basis: g.basisAmount,
        goal: goalVisible ? g.goalAmount : null,
        isOverride: goalVisible ? g.isOverride : false,
        // Only surface actuals for days that have started (store-local).
        actual: dateStr <= today ? actualByDate.get(dateStr) ?? null : null,
      }
    }),
  })
}
