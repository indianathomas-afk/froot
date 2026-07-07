import { prisma } from "@/lib/prisma"
import { getSquareClient } from "@/lib/square"
import type { Organization, Store } from "@prisma/client"

// ─── Square sales sync ────────────────────────────────────────────────────────
// Pulls COMPLETED orders (closed_at window) for one store and aggregates them
// into SalesPeriodCache (daily), SalesLineCache (daily × variation), and
// SalesHourlyCache (daily × hour). Dates/hours are bucketed in the STORE's
// timezone. Idempotent per day: every local date touched by the window is
// deleted and rewritten in one transaction.

type SquareMoney = { amount?: number; currency?: string } | null | undefined

type SquareLineItem = {
  catalog_object_id?: string
  quantity?: string
  gross_sales_money?: SquareMoney
  total_money?: SquareMoney
}

type SquareOrder = {
  id: string
  closed_at?: string
  total_money?: SquareMoney
  total_tax_money?: SquareMoney
  total_discount_money?: SquareMoney
  line_items?: SquareLineItem[]
}

function dollars(m: SquareMoney): number {
  return (m?.amount ?? 0) / 100
}

// Wall-clock parts of a UTC instant in a target IANA timezone.
function localParts(instant: Date, timeZone: string): { dateStr: string; hour: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  })
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]))
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

// UTC instant of local midnight for a yyyy-mm-dd in a timezone. (DST shifts at
// midnight are rare enough to accept the one-pass approximation.)
export function localMidnightUtc(dateStr: string, timeZone: string): Date {
  const naive = new Date(`${dateStr}T00:00:00.000Z`)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const p = Object.fromEntries(dtf.formatToParts(naive).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  const offsetMs = asUtc - naive.getTime()
  return new Date(naive.getTime() - offsetMs)
}

// @db.Date columns store UTC-midnight Dates.
function dbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

function eachDateStr(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const d = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export type SalesSyncResult = {
  storeId: string
  startDate: string
  endDate: string
  orders: number
  days: number
}

// startDate/endDate: inclusive yyyy-mm-dd in the store's local calendar.
export async function syncSalesForStore(
  org: Organization,
  store: Store,
  startDate: string,
  endDate: string
): Promise<SalesSyncResult> {
  if (!store.squareLocationId) throw new Error("STORE_NOT_LINKED")

  const client = await getSquareClient(org)
  const tz = store.timezone

  const startAt = localMidnightUtc(startDate, tz)
  const endNext = new Date(`${endDate}T00:00:00.000Z`)
  endNext.setUTCDate(endNext.getUTCDate() + 1)
  const endAt = localMidnightUtc(endNext.toISOString().slice(0, 10), tz)

  type DayAgg = { gross: number; net: number; tax: number; discount: number; orders: number }
  const byDay = new Map<string, DayAgg>()
  const byHour = new Map<string, { net: number; orders: number }>() // `${date}|${hour}`
  const byLine = new Map<string, { qty: number; gross: number }>() // `${date}|${variationId}`

  let cursor: string | undefined
  let orderCount = 0

  do {
    const res = await fetch(`${client.baseUrl}/v2/orders/search`, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        location_ids: [store.squareLocationId],
        limit: 500,
        cursor,
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: {
              closed_at: { start_at: startAt.toISOString(), end_at: endAt.toISOString() },
            },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`SQUARE_SEARCH_ORDERS_FAILED:${res.status}:${text.slice(0, 300)}`)
    }

    const data = (await res.json()) as { orders?: SquareOrder[]; cursor?: string }
    for (const order of data.orders ?? []) {
      if (!order.closed_at) continue
      const instant = new Date(order.closed_at)
      const { dateStr, hour } = localParts(instant, tz)
      // Orders can close a few minutes past local midnight into a date outside
      // the requested window — keep them; their day gets rewritten too.

      const gross = dollars(order.total_money)
      const tax = dollars(order.total_tax_money)
      const discount = dollars(order.total_discount_money)
      const net = gross - tax

      const day = byDay.get(dateStr) ?? { gross: 0, net: 0, tax: 0, discount: 0, orders: 0 }
      day.gross += gross
      day.net += net
      day.tax += tax
      day.discount += discount
      day.orders += 1
      byDay.set(dateStr, day)

      const hourKey = `${dateStr}|${hour}`
      const h = byHour.get(hourKey) ?? { net: 0, orders: 0 }
      h.net += net
      h.orders += 1
      byHour.set(hourKey, h)

      for (const line of order.line_items ?? []) {
        if (!line.catalog_object_id) continue
        const lineKey = `${dateStr}|${line.catalog_object_id}`
        const agg = byLine.get(lineKey) ?? { qty: 0, gross: 0 }
        agg.qty += Number(line.quantity ?? "1") || 0
        agg.gross += dollars(line.gross_sales_money ?? line.total_money)
        byLine.set(lineKey, agg)
      }

      orderCount += 1
    }
    cursor = data.cursor
  } while (cursor)

  // Rewrite every date in the requested window plus any spillover dates seen.
  const dates = new Set<string>(eachDateStr(startDate, endDate))
  for (const d of byDay.keys()) dates.add(d)
  const dateList = [...dates].map(dbDate)

  await prisma.$transaction(async (tx) => {
    await tx.salesPeriodCache.deleteMany({ where: { storeId: store.id, date: { in: dateList } } })
    await tx.salesHourlyCache.deleteMany({ where: { storeId: store.id, date: { in: dateList } } })
    await tx.salesLineCache.deleteMany({ where: { storeId: store.id, date: { in: dateList } } })

    await tx.salesPeriodCache.createMany({
      data: [...dates].map((dateStr) => {
        const day = byDay.get(dateStr) ?? { gross: 0, net: 0, tax: 0, discount: 0, orders: 0 }
        return {
          organizationId: org.id,
          storeId: store.id,
          date: dbDate(dateStr),
          grossSales: day.gross,
          netSales: day.net,
          taxTotal: day.tax,
          discountTotal: day.discount,
          orderCount: day.orders,
        }
      }),
    })

    if (byHour.size > 0) {
      await tx.salesHourlyCache.createMany({
        data: [...byHour.entries()].map(([key, v]) => {
          const [dateStr, hourStr] = key.split("|")
          return {
            organizationId: org.id,
            storeId: store.id,
            date: dbDate(dateStr),
            hour: Number(hourStr),
            netSales: v.net,
            orderCount: v.orders,
          }
        }),
      })
    }

    if (byLine.size > 0) {
      await tx.salesLineCache.createMany({
        data: [...byLine.entries()].map(([key, v]) => {
          const [dateStr, variationId] = key.split("|")
          return {
            organizationId: org.id,
            storeId: store.id,
            date: dbDate(dateStr),
            squareVariationId: variationId,
            quantitySold: v.qty,
            grossSales: v.gross,
          }
        }),
      })
    }
  })

  return { storeId: store.id, startDate, endDate, orders: orderCount, days: dates.size }
}

// Latest cached sales date for a store (yyyy-mm-dd) or null.
export async function getSyncedThrough(storeId: string): Promise<string | null> {
  const latest = await prisma.salesPeriodCache.findFirst({
    where: { storeId },
    orderBy: { date: "desc" },
    select: { date: true },
  })
  return latest ? latest.date.toISOString().slice(0, 10) : null
}

// Ensure the cache covers [startDate, endDate] — syncs only the missing tail
// (cheap gap-fill used by reports before reading the cache).
export async function ensureSalesCached(
  org: Organization,
  store: Store,
  startDate: string,
  endDate: string
): Promise<void> {
  if (!store.squareLocationId || !org.squareAccessToken) return
  const cached = await prisma.salesPeriodCache.findMany({
    where: { storeId: store.id, date: { gte: dbDate(startDate), lte: dbDate(endDate) } },
    select: { date: true },
  })
  const have = new Set(cached.map((c) => c.date.toISOString().slice(0, 10)))
  const missing = eachDateStr(startDate, endDate).filter((d) => !have.has(d))
  if (missing.length === 0) return
  // One contiguous fetch across the missing span keeps Square calls simple.
  await syncSalesForStore(org, store, missing[0], missing[missing.length - 1])
}
