import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
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
    canEdit: ctx.isAdmin,
    days: goals.map((g) => {
      const dateStr = g.date.toISOString().slice(0, 10)
      return {
        date: dateStr,
        basis: g.basisAmount,
        goal: g.goalAmount,
        isOverride: g.isOverride,
        // Only surface actuals for days that have started (store-local).
        actual: dateStr <= today ? actualByDate.get(dateStr) ?? null : null,
      }
    }),
  })
}
