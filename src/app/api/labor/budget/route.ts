import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr, dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { computeWeeklyLaborBudget } from "@/lib/labor-budget"
import { getWeeklyForecast } from "@/lib/labor-forecast"
import { splitWeeklyHoursToDays, applyDayAdjustment } from "@/lib/labor-daily"

// GET /api/labor/budget?storeId=&weekStart= — the derived weekly labor budget.
// Phase 2: the week's projected sales are AUTO-DERIVED (getWeeklyForecast:
// MANUAL override else the Forecasting DailyGoal sum) — no data entry. Total
// sales only (no denominator). Per-day adjustments scale that day's hourly
// hours; the hero shows the adjusted weekly total. Read-only, any role that can
// see the store. hasForecast:false → the card shows its empty state.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// weekday index for a yyyy-mm-dd, 0 = Monday … 6 = Sunday (matches labor-week).
function weekdayOf(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay() // 0 Sun..6 Sat
  return (dow + 6) % 7
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
  const weekEnd = (() => {
    const d = new Date(`${weekStart}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() + 6)
    return d.toISOString().slice(0, 10)
  })()

  const [settingsRow, positions, forecast] = await Promise.all([
    prisma.laborSettings.findFirst({ where: { organizationId: ctx.org.id, storeId: null } }),
    prisma.laborPosition.findMany({ where: { organizationId: ctx.org.id, active: true } }),
    getWeeklyForecast(storeId, weekStart),
  ])

  const settings = {
    laborTargetPct: settingsRow ? Number(settingsRow.laborTargetPct) : 20,
    roundingIncrement: settingsRow ? Number(settingsRow.roundingIncrement) : 1000,
    plannedBlendedRate: settingsRow?.plannedBlendedRate == null ? null : Number(settingsRow.plannedBlendedRate),
  }

  const budget = computeWeeklyLaborBudget({
    settings,
    positions: positions.map((p) => ({
      payType: p.payType,
      defaultHourlyRate: Number(p.defaultHourlyRate),
      impliedWeeklyHours: p.impliedWeeklyHours,
      active: p.active,
    })),
    forecast: forecast ? { total: forecast.total } : null,
  })

  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"
  const base = {
    store: { id: store.id, name: store.name, timezone: store.timezone },
    today,
    weekStart,
    canManage,
    target: settings.laborTargetPct,
  }

  if (!budget) {
    return NextResponse.json({ ...base, source: null, hasForecast: false, forecast: null, budget: null, adjustedTotalSchedulableHours: null, weekAdjustments: [] })
  }

  // Per-day adjustments (weather/holiday) scale HOURLY hours only. Split the
  // weekly hourly hours by the day-split weights, apply each day's adjustment,
  // and re-sum for the adjusted weekly total (salaried is untouched).
  const [splitRows, adjRows] = await Promise.all([
    prisma.laborDaySplit.findMany({ where: { storeId } }),
    prisma.laborDayAdjustment.findMany({ where: { storeId, date: { gte: dbDate(weekStart), lte: dbDate(weekEnd) } } }),
  ])

  const weightsByWeekday =
    splitRows.length > 0
      ? Array.from({ length: 7 }, (_, wd) => splitRows.find((r) => r.weekday === wd)?.weightBps ?? 0)
      : null
  const adjByWeekday = new Map<number, { pct: number; reason: string | null; date: string }>()
  for (const a of adjRows) {
    const dateStr = a.date.toISOString().slice(0, 10)
    adjByWeekday.set(weekdayOf(dateStr), { pct: Number(a.adjustmentPct), reason: a.reason, date: dateStr })
  }

  const daily = splitWeeklyHoursToDays({ weeklyHourlyHours: budget.hourlyHours, weightsByWeekday, openDays: [0, 1, 2, 3, 4, 5, 6] })
  const adjustedHourly = daily.reduce((sum, d) => {
    const adj = adjByWeekday.get(d.weekday)
    return sum + (adj ? applyDayAdjustment(d.hourlyHours, adj.pct) : d.hourlyHours)
  }, 0)
  const adjustedTotalSchedulableHours = +(budget.salariedHours + adjustedHourly).toFixed(1)

  const weekAdjustments = adjRows
    .map((a) => ({ date: a.date.toISOString().slice(0, 10), adjustmentPct: Number(a.adjustmentPct), reason: a.reason }))
    .sort((x, y) => x.date.localeCompare(y.date))

  return NextResponse.json({
    ...base,
    source: forecast!.source,
    hasForecast: true,
    forecast: { total: forecast!.total, source: forecast!.source },
    budget,
    adjustedTotalSchedulableHours,
    weekAdjustments,
  })
}
