import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr, dbDate } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { computeWeeklyLaborBudget } from "@/lib/labor-budget"
import { getWeeklyForecast } from "@/lib/labor-forecast"
import { splitWeeklyHoursToDays, applyDayAdjustment } from "@/lib/labor-daily"
import { computeDailyCoverage, type DaypartRule } from "@/lib/labor-coverage"

// GET /api/labor/coverage?storeId=&date= — rule-based recommended coverage for
// one day (Phase 2B, guidance). Auto-forecast → weekly budget → daily hourly
// split → per-day adjustment → min-staffing coverage against StoreHours +
// dayparts. Demand shape is the SalesHourlyCache (same source as the Sales
// card). Read-only, any role that can see the store.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseHourStart(t: string | null): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.floor(Number(m[1]) + Number(m[2]) / 60) : null
}
function parseHourEnd(t: string | null): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.ceil(Number(m[1]) + Number(m[2]) / 60) : null
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
  const date = dateParam && DATE_RE.test(dateParam) && dateParam <= today ? dateParam : today
  const weekStart = mondayOfWeekStr(date)
  const jsDow = new Date(`${date}T00:00:00.000Z`).getUTCDay() // 0 Sun..6 Sat (StoreHours)
  const laborWeekday = (jsDow + 6) % 7 // 0 Mon..6 Sun (LaborDaySplit)

  const available =
    ctx.org.activeModules.includes("inventory") && !!store.squareLocationId && !!ctx.org.squareAccessToken
  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"
  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, date, weekStart, available, canManage }

  const [settingsRow, positions, forecast, hourlyRows, splitRows, adjRow, storeDayparts, orgDayparts, storeHours] =
    await Promise.all([
      prisma.laborSettings.findFirst({ where: { organizationId: ctx.org.id, storeId: null } }),
      prisma.laborPosition.findMany({ where: { organizationId: ctx.org.id, active: true } }),
      getWeeklyForecast(storeId, weekStart),
      prisma.salesHourlyCache.findMany({ where: { storeId, date: dbDate(date) }, orderBy: { hour: "asc" } }),
      prisma.laborDaySplit.findMany({ where: { storeId } }),
      prisma.laborDayAdjustment.findUnique({ where: { storeId_date: { storeId, date: dbDate(date) } } }),
      prisma.laborDaypart.findMany({ where: { organizationId: ctx.org.id, storeId, active: true }, orderBy: { sortOrder: "asc" } }),
      prisma.laborDaypart.findMany({ where: { organizationId: ctx.org.id, storeId: null, active: true }, orderBy: { sortOrder: "asc" } }),
      prisma.storeHours.findFirst({ where: { storeId, dayOfWeek: jsDow } }),
    ])

  const budget = computeWeeklyLaborBudget({
    settings: {
      laborTargetPct: settingsRow ? Number(settingsRow.laborTargetPct) : 20,
      roundingIncrement: settingsRow ? Number(settingsRow.roundingIncrement) : 1000,
      plannedBlendedRate: settingsRow?.plannedBlendedRate == null ? null : Number(settingsRow.plannedBlendedRate),
    },
    positions: positions.map((p) => ({ payType: p.payType, defaultHourlyRate: Number(p.defaultHourlyRate), impliedWeeklyHours: p.impliedWeeklyHours, active: p.active })),
    forecast: forecast ? { total: forecast.total } : null,
  })

  if (!budget) {
    return NextResponse.json({ ...base, hasForecast: false, hasShape: false, coverage: null, adjustment: null })
  }

  // Weekly hourly hours → this weekday's share → apply the day adjustment.
  const weightsByWeekday = splitRows.length > 0 ? Array.from({ length: 7 }, (_, wd) => splitRows.find((r) => r.weekday === wd)?.weightBps ?? 0) : null
  const daily = splitWeeklyHoursToDays({ weeklyHourlyHours: budget.hourlyHours, weightsByWeekday, openDays: [0, 1, 2, 3, 4, 5, 6] })
  const dayHourly = daily.find((d) => d.weekday === laborWeekday)?.hourlyHours ?? 0
  const adjustmentPct = adjRow ? Number(adjRow.adjustmentPct) : 0
  const adjustedDayHours = applyDayAdjustment(dayHourly, adjustmentPct)

  // Store-specific dayparts win over org defaults.
  const daypartRows = storeDayparts.length > 0 ? storeDayparts : orgDayparts
  const dayparts: DaypartRule[] = daypartRows.map((d) => ({
    name: d.name,
    startHour: Math.floor(d.startLocalMinutes / 60),
    endHour: Math.ceil(d.endLocalMinutes / 60),
    minHeadcount: d.minHeadcount,
    requiresSupervisor: d.requiresSupervisor,
  }))

  const open =
    storeHours && !storeHours.isClosed
      ? (() => {
          const s = parseHourStart(storeHours.openingTime)
          const e = parseHourEnd(storeHours.closingTime)
          return s != null && e != null && e > s ? { startHour: s, endHour: e } : null
        })()
      : null

  const coverage = computeDailyCoverage({
    dayHours: adjustedDayHours,
    hourly: hourlyRows.map((h) => ({ hour: h.hour, net: h.netSales })),
    open,
    dayparts,
    hasSupervisoryPosition: positions.some((p) => p.isSupervisory),
  })

  return NextResponse.json({
    ...base,
    hasForecast: true,
    hasShape: !!coverage,
    adjustment: adjRow ? { adjustmentPct, reason: adjRow.reason } : null,
    coverage,
  })
}
