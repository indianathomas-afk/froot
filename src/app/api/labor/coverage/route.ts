import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr, dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { computeWeeklyLaborBudget } from "@/lib/labor-budget"
import { recommendCoverage } from "@/lib/labor-coverage"

// GET /api/labor/coverage?storeId=&date= — recommended staff-on-floor by hour
// for one day (guidance). Reuses the SAME hourly-sales source as the Dashboard
// Sales Performance card (SalesHourlyCache) for the demand shape. Read-only,
// any role that can see the store. Returns flags rather than errors so the card
// degrades to a muted state (no Square, no forecast, or no hourly shape) instead
// of breaking.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const dateParam = url.searchParams.get("date")
  const date = dateParam && DATE_RE.test(dateParam) && dateParam <= today ? dateParam : today
  const weekStart = mondayOfWeekStr(date)
  const weekEnd = (() => {
    const d = new Date(`${weekStart}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() + 6)
    return d.toISOString().slice(0, 10)
  })()

  const available =
    ctx.org.activeModules.includes("inventory") && !!store.squareLocationId && !!ctx.org.squareAccessToken

  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, date, weekStart, available }

  // Budget for the week (same derivation as /api/labor/budget).
  const [settingsRow, positions, forecastRow, hourlyRows, weekRows] = await Promise.all([
    prisma.laborSettings.findFirst({ where: { organizationId: ctx.org.id, storeId: null } }),
    prisma.laborPosition.findMany({ where: { organizationId: ctx.org.id, active: true } }),
    prisma.salesForecast.findUnique({
      where: { storeId_weekStart: { storeId, weekStart: new Date(`${weekStart}T00:00:00.000Z`) } },
    }),
    prisma.salesHourlyCache.findMany({ where: { storeId, date: dbDate(date) }, orderBy: { hour: "asc" } }),
    prisma.salesPeriodCache.findMany({ where: { storeId, date: { gte: dbDate(weekStart), lte: dbDate(weekEnd) } } }),
  ])

  const budget = computeWeeklyLaborBudget({
    settings: {
      laborTargetPct: settingsRow ? Number(settingsRow.laborTargetPct) : 20,
      roundingIncrement: settingsRow ? Number(settingsRow.roundingIncrement) : 1000,
      denominator: settingsRow?.denominator ?? "TOTAL_WITH_DELIVERY",
      plannedBlendedRate: settingsRow?.plannedBlendedRate == null ? null : Number(settingsRow.plannedBlendedRate),
    },
    positions: positions.map((p) => ({
      payType: p.payType,
      defaultHourlyRate: Number(p.defaultHourlyRate),
      impliedWeeklyHours: p.impliedWeeklyHours,
      active: p.active,
    })),
    forecast: forecastRow
      ? { projectedStoreSales: Number(forecastRow.projectedStoreSales), projectedDelivery: Number(forecastRow.projectedDelivery) }
      : null,
  })

  if (!budget) {
    return NextResponse.json({ ...base, hasForecast: false, hasShape: false, coverage: null, totalSchedulableHours: null })
  }

  // Demand shape from the day's hourly sales (same source as the Sales card).
  const hourly = hourlyRows.map((h) => ({ hour: h.hour, net: h.netSales }))

  // ── Weekly→daily split (the one tunable heuristic): this day's share of the
  // week's sales, from cached actuals. Falls back to an even 1/7 when the week
  // has no sales yet (e.g. a fresh week with only a forecast).
  const weekTotal = weekRows.reduce((s, r) => s + r.netSales, 0)
  const dayNet = weekRows.find((r) => r.date.toISOString().slice(0, 10) === date)?.netSales ?? hourly.reduce((s, h) => s + h.net, 0)
  const dayShareOfWeek = weekTotal > 0 ? Math.min(1, dayNet / weekTotal) : 1 / 7

  const coverage = recommendCoverage({
    hourly,
    dayShareOfWeek,
    totalSchedulableHours: budget.totalSchedulableHours,
  })

  return NextResponse.json({
    ...base,
    hasForecast: true,
    hasShape: !!coverage,
    target: budget.projectedLaborPctAtForecast,
    totalSchedulableHours: budget.totalSchedulableHours,
    dayShareOfWeek,
    coverage,
  })
}
