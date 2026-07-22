import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { localDateStr, dbDate } from "@/lib/reports"
import { syncSalesForStore, ensureSalesCached } from "@/lib/sales-sync"

// GET /api/dashboard/sales?storeId=&start=&end=&compare= — sales data for the
// Dashboard's Sales Performance card. The selection may be a single day
// (hourly series) or a range (daily series); the comparison window is resolved
// server-side and always has the same length as the selection. Available to
// every role that can see the store (same scope check as /api/dashboard/summary).

// BUG-1: the stale-cache/gap-fill path runs a synchronous Square sync — give
// it the same headroom the rollup route already has.
export const maxDuration = 60

const STALE_MS = 15 * 60 * 1000
const MAX_RANGE_DAYS = 366

const COMPARE_MODES = [
  "prior_period",
  "same_weekday_last_year",
  "four_weeks_prior",
  "fifty_two_weeks_prior",
  "prior_year",
] as const

const querySchema = z.object({
  storeId: z.string().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compare: z.enum(COMPARE_MODES),
})

function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
}

// Same calendar date one year earlier; Feb 29 clamps to Feb 28.
function priorCalendarYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y - 1, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0)
  return dt.toISOString().slice(0, 10)
}

// Comparison window start; the end is always start + (selection length − 1),
// so both windows have identical length and the chart aligns bucket-for-bucket.
function comparisonStart(mode: (typeof COMPARE_MODES)[number], selStart: string, selDays: number): string {
  switch (mode) {
    case "prior_period":
      return shiftDateStr(selStart, -selDays)
    case "same_weekday_last_year":
    case "fifty_two_weeks_prior":
      return shiftDateStr(selStart, -364) // 52 weeks — same weekday
    case "four_weeks_prior":
      return shiftDateStr(selStart, -28)
    case "prior_year":
      return priorCalendarYear(selStart)
  }
}

type WindowData = {
  net: number
  gross: number
  orders: number
  avgSale: number | null
  unconfirmed: number
  hasData: boolean
  series: { x: string; net: number }[]
}

async function loadWindow(storeId: string, start: string, end: string, hourly: boolean): Promise<WindowData> {
  const dayRows = await prisma.salesPeriodCache.findMany({
    where: { storeId, date: { gte: dbDate(start), lte: dbDate(end) } },
    orderBy: { date: "asc" },
  })
  const net = dayRows.reduce((s, r) => s + r.netSales, 0)
  const gross = dayRows.reduce((s, r) => s + r.grossSales, 0)
  const orders = dayRows.reduce((s, r) => s + r.orderCount, 0)
  const unconfirmed = dayRows.reduce((s, r) => s + r.unconfirmedNet, 0)

  let series: { x: string; net: number }[]
  if (hourly) {
    const hours = await prisma.salesHourlyCache.findMany({
      where: { storeId, date: dbDate(start) },
      orderBy: { hour: "asc" },
    })
    series = hours.map((h) => ({ x: String(h.hour), net: h.netSales }))
  } else {
    const byDate = new Map(dayRows.map((r) => [r.date.toISOString().slice(0, 10), r.netSales]))
    series = []
    for (let d = start; d <= end; d = shiftDateStr(d, 1)) {
      series.push({ x: d, net: byDate.get(d) ?? 0 })
    }
  }

  return {
    net,
    gross,
    orders,
    avgSale: orders > 0 ? net / orders : null,
    unconfirmed,
    hasData: dayRows.some((r) => r.orderCount > 0 || r.netSales > 0),
    series,
  }
}

export async function GET(req: Request) {
  const t0 = Date.now()
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch (err) {
    // BUG-1: this catch also swallows DB/connection errors — log the real cause.
    console.error("[api/dashboard/sales] auth/context error:", err)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx
  const isAdmin = dbUser?.role === "ADMIN"
  const scopedStoreIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    storeId: url.searchParams.get("storeId"),
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
    compare: url.searchParams.get("compare"),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 })
  }
  const { storeId, compare, start } = parsed.data
  let { end } = parsed.data

  if (!isAdmin && !scopedStoreIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const tz = store.timezone
  const today = localDateStr(new Date(), tz)

  // Future dates are never selectable; clamp rather than error so a stale
  // client selection (e.g. "today" persisted across midnight) still resolves.
  if (end > today) end = today
  if (start > end) return NextResponse.json({ error: "start must be on or before end" }, { status: 400 })
  const selDays = daysInclusive(start, end)
  if (selDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `Range is limited to ${MAX_RANGE_DAYS} days` }, { status: 400 })
  }

  const compStart = comparisonStart(compare, start, selDays)
  const compEnd = shiftDateStr(compStart, selDays - 1)

  const salesAvailable =
    org.activeModules.includes("inventory") && !!store.squareLocationId && !!org.squareAccessToken

  if (!salesAvailable) {
    return NextResponse.json({
      store: { id: store.id, name: store.name, timezone: tz },
      today,
      salesAvailable: false,
      selection: { start, end },
      comparison: { start: compStart, end: compEnd, mode: compare },
      granularity: start === end ? "hourly" : "daily",
      selected: null,
      compareData: null,
    })
  }

  try {
    // Refresh today when the selection touches it and the cache is stale;
    // gap-fill both windows once (backfills from Square on first view).
    if (end === today) {
      const todayRow = await prisma.salesPeriodCache.findUnique({
        where: { storeId_date: { storeId, date: dbDate(today) } },
        select: { syncedAt: true },
      })
      if (!todayRow || Date.now() - todayRow.syncedAt.getTime() > STALE_MS) {
        await syncSalesForStore(org, store, today, today)
      }
    }
    await ensureSalesCached(org, store, start, end)
    await ensureSalesCached(org, store, compStart, compEnd)
  } catch (err) {
    // Square being down never blanks the card — serve what's cached.
    console.error(`[api/dashboard/sales] sales sync failed (serving cache) store=${storeId}:`, err)
  }

  const hourly = start === end
  const [selected, compareData] = await Promise.all([
    loadWindow(storeId, start, end, hourly),
    loadWindow(storeId, compStart, compEnd, hourly),
  ])

  // BUG-1 evidence line: request duration in the runtime logs.
  console.log(`[api/dashboard/sales] ${Date.now() - t0}ms store=${storeId} ${start}..${end}`)

  return NextResponse.json({
    store: { id: store.id, name: store.name, timezone: tz },
    today,
    salesAvailable: true,
    selection: { start, end },
    comparison: { start: compStart, end: compEnd, mode: compare },
    granularity: hourly ? "hourly" : "daily",
    selected,
    compareData,
  })
}
