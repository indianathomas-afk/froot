import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { buildForecastCsv, type ForecastCsvRow } from "@/lib/forecast-csv"
import { dbDate, localDateStr } from "@/lib/reports"
import { daysInMonth } from "@/lib/pacing"

// GET /api/forecasting/export?storeId=&year=&month=&shape= — CSV download of a
// store's goals (Phase F-5), the reverse of /api/forecasting/import. The first
// two columns are (date|month, goal) so the file round-trips through the
// importer; actual and variance columns ride along for analysis. Same read
// scoping as the rest of forecasting (admins + managers). Server-side CSV,
// same pattern as /api/templates/export.

export async function GET(req: Request) {
  const ctx = await requireForecastContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const month = url.searchParams.get("month") // yyyy-mm → just that month
  const shape = url.searchParams.get("shape") === "monthly" ? ("monthly" as const) : ("daily" as const)
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be yyyy-mm" }, { status: 400 })
  }

  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  const year = month
    ? Number(month.slice(0, 4))
    : Number(url.searchParams.get("year")) || Number(localDateStr(new Date(), store.timezone).slice(0, 4))

  const start = month ? `${month}-01` : `${year}-01-01`
  const end = month ? `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, "0")}` : `${year}-12-31`

  const [goals, actuals] = await Promise.all([
    prisma.dailyGoal.findMany({
      where: { storeId, date: { gte: dbDate(start), lte: dbDate(end) } },
      orderBy: { date: "asc" },
      select: { date: true, goalAmount: true },
    }),
    prisma.salesPeriodCache.findMany({
      where: { storeId, date: { gte: dbDate(start), lte: dbDate(end) } },
      select: { date: true, netSales: true },
    }),
  ])
  if (goals.length === 0) {
    return NextResponse.json(
      { error: `No goal plan covers ${month ?? year} for this store — create it in Forecasting first.` },
      { status: 404 }
    )
  }

  const actualByDate = new Map(actuals.map((a) => [a.date.toISOString().slice(0, 10), a.netSales]))

  let rows: ForecastCsvRow[]
  if (shape === "daily") {
    rows = goals.map((g) => {
      const key = g.date.toISOString().slice(0, 10)
      return { key, goal: g.goalAmount, actual: actualByDate.get(key) ?? null }
    })
  } else {
    const byMonth = new Map<string, { goal: number; actual: number; hasActual: boolean }>()
    for (const g of goals) {
      const key = g.date.toISOString().slice(0, 7)
      const m = byMonth.get(key) ?? { goal: 0, actual: 0, hasActual: false }
      m.goal += g.goalAmount
      const actual = actualByDate.get(g.date.toISOString().slice(0, 10))
      if (actual !== undefined) {
        m.actual += actual
        m.hasActual = true
      }
      byMonth.set(key, m)
    }
    rows = [...byMonth.entries()].map(([key, m]) => ({ key, goal: m.goal, actual: m.hasActual ? m.actual : null }))
  }

  const csv = buildForecastCsv(shape, rows)
  const slug = store.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const span = month ?? String(year)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="froot-forecast-${slug}-${span}-${shape}.csv"`,
    },
  })
}
