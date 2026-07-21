import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr, dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { computeWeeklyLaborBudget } from "@/lib/labor-budget"
import { getWeeklyForecast } from "@/lib/labor-forecast"
import { resolveLaborSettings } from "@/lib/labor-settings"
import { splitWeeklyHoursToDays, applyDayAdjustment } from "@/lib/labor-daily"
import { computeDailyCoverage, type HourNet } from "@/lib/labor-coverage"

// GET /api/labor/coverage?storeId=&date= — demand-shaped, budget-capped
// recommended coverage for one day (Phase 3, guidance). Works for FUTURE days
// (up to the UI's 4-week horizon): future demand shape = average of the same
// weekday over the last 4 weeks of SalesHourlyCache. The salaried GM is counted
// on floor in their window. Read-only, any role that can see the store.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const shift = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const jsDowOf = (dateStr: string) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDay() // 0 Sun..6 Sat
const laborWeekdayOf = (dateStr: string) => (jsDowOf(dateStr) + 6) % 7 // 0 Mon..6 Sun

function parseHourStart(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.floor(Number(m[1]) + Number(m[2]) / 60) : null
}
function parseHourEnd(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.ceil(Number(m[1]) + Number(m[2]) / 60) : null
}

// The day's hourly demand shape. Past/today with data → the day's actuals;
// otherwise (future, or a gap) the average of the same weekday over the last 4
// weeks (dates ≤ today).
async function getDemandShape(storeId: string, date: string, today: string): Promise<HourNet[]> {
  if (date <= today) {
    const rows = await prisma.salesHourlyCache.findMany({ where: { storeId, date: dbDate(date) }, orderBy: { hour: "asc" } })
    if (rows.length > 0) return rows.map((r) => ({ hour: r.hour, net: r.netSales }))
  }
  // Most recent same-weekday ≤ today, then the 3 prior weeks.
  const targetWd = jsDowOf(date)
  let cursor = today
  for (let i = 0; i < 7 && jsDowOf(cursor) !== targetWd; i++) cursor = shift(cursor, -1)
  const dates = [0, 7, 14, 21].map((k) => shift(cursor, -k))
  const rows = await prisma.salesHourlyCache.findMany({
    where: { storeId, date: { in: dates.map((d) => dbDate(d)) } },
  })
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

export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const dateParam = url.searchParams.get("date")
  // Allow future up to +28 days (the 4-week horizon); clamp anything sillier.
  let date = dateParam && DATE_RE.test(dateParam) ? dateParam : today
  if (date > shift(today, 28)) date = shift(today, 28)
  const weekStart = mondayOfWeekStr(date)

  const available = ctx.org.activeModules.includes("inventory") && !!store.squareLocationId && !!ctx.org.squareAccessToken
  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"
  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, date, weekStart, available, canManage }

  const [settings, positions, forecast, splitRows, adjRow, storeHours] = await Promise.all([
    resolveLaborSettings(ctx.org.id, storeId),
    prisma.laborPosition.findMany({ where: { organizationId: ctx.org.id, active: true } }),
    getWeeklyForecast(storeId, weekStart),
    prisma.laborDaySplit.findMany({ where: { storeId } }),
    prisma.laborDayAdjustment.findUnique({ where: { storeId_date: { storeId, date: dbDate(date) } } }),
    prisma.storeHours.findFirst({ where: { storeId, dayOfWeek: jsDowOf(date) } }),
  ])

  const budget = computeWeeklyLaborBudget({
    settings,
    positions: positions.map((p) => ({ payType: p.payType, defaultHourlyRate: Number(p.defaultHourlyRate), impliedWeeklyHours: p.impliedWeeklyHours, active: p.active })),
    forecast: forecast ? { total: forecast.total } : null,
  })
  if (!budget) return NextResponse.json({ ...base, hasForecast: false, hasShape: false, coverage: null, adjustment: null })

  // Weekly hourly hours → this weekday's share → day adjustment = the hourly cap.
  const weights = splitRows.length > 0 ? Array.from({ length: 7 }, (_, wd) => splitRows.find((r) => r.weekday === wd)?.weightBps ?? 0) : null
  const daily = splitWeeklyHoursToDays({ weeklyHourlyHours: budget.hourlyHours, weightsByWeekday: weights, openDays: [0, 1, 2, 3, 4, 5, 6] })
  const dayHourly = daily.find((d) => d.weekday === laborWeekdayOf(date))?.hourlyHours ?? 0
  const adjustmentPct = adjRow ? Number(adjRow.adjustmentPct) : 0
  const hourlyBudgetHours = applyDayAdjustment(dayHourly, adjustmentPct)

  const open =
    storeHours && !storeHours.isClosed
      ? (() => {
          const s = parseHourStart(storeHours.openingTime)
          const e = parseHourEnd(storeHours.closingTime)
          return s != null && e != null && e > s ? { startHour: s, endHour: e } : null
        })()
      : null

  // GM on-floor window (option b, open→14:00 default), only if a salaried GM exists.
  const hasGm = positions.some((p) => p.payType === "SALARIED")
  const gmStart = settings.gmOnFloorStartMinutes != null ? Math.floor(settings.gmOnFloorStartMinutes / 60) : open?.startHour ?? 8
  const gmEnd = settings.gmOnFloorEndMinutes != null ? Math.ceil(settings.gmOnFloorEndMinutes / 60) : 14
  const gmWindow = hasGm && gmEnd > gmStart ? { startHour: gmStart, endHour: gmEnd } : null

  const demand = await getDemandShape(storeId, date, today)
  const coverage = computeDailyCoverage({
    hourlyBudgetHours,
    demand,
    open,
    gmWindow,
    hasHourlySupervisor: positions.some((p) => p.isSupervisory && p.payType === "HOURLY"),
  })

  return NextResponse.json({
    ...base,
    hasForecast: true,
    hasShape: !!coverage,
    isFuture: date > today,
    adjustment: adjRow ? { adjustmentPct, reason: adjRow.reason } : null,
    coverage,
  })
}
