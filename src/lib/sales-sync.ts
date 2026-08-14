import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { getSquareClient } from "@/lib/square"
import { Prisma } from "@prisma/client"
import type { Organization, Store } from "@prisma/client"

// ─── Square sales sync ────────────────────────────────────────────────────────
// Pulls PAID orders (has a tender; OPEN or COMPLETED) in the created_at window
// for one store and aggregates them into SalesPeriodCache (daily), SalesLineCache
// (daily × variation), and SalesHourlyCache (daily × hour). Dates/hours are
// bucketed by each order's created_at in the STORE's timezone — matching how
// Square's Sales Summary counts a sale (when it's paid, on the day it opened).
//
// Idempotent per day, and since BUG-7 also SAFE UNDER CONCURRENCY: each local
// date is written through a guarded upsert that keeps whichever sync READ
// Square most recently, regardless of which committed first. A sync whose data
// is already superseded writes nothing for that day and says so in its result
// (`discardedDays`). See writeSalesCache below.
//
// Because every sync re-reads the whole day from Square, discarding a superseded
// write never loses information — the winner's read covers everything the loser
// saw. That invariant is what makes newest-fetch-wins safe rather than merely
// convenient.

type SquareMoney = { amount?: number; currency?: string } | null | undefined

type SquareLineItem = {
  catalog_object_id?: string
  quantity?: string
  gross_sales_money?: SquareMoney
  total_money?: SquareMoney
}

type SquareOrder = {
  id: string
  created_at?: string
  closed_at?: string
  state?: string
  tenders?: { id?: string }[]
  total_money?: SquareMoney
  total_tax_money?: SquareMoney
  total_tip_money?: SquareMoney
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
  /** BUG-7: days this sync did NOT write because a newer fetch already had. */
  discardedDays: number
}

export type DayAgg = { gross: number; net: number; tax: number; tip: number; discount: number; orders: number; unconfirmed: number }
export type HourAgg = { net: number; orders: number }
export type LineAgg = { qty: number; gross: number }

export function emptyDayAgg(): DayAgg {
  return { gross: 0, net: 0, tax: 0, tip: 0, discount: 0, orders: 0, unconfirmed: 0 }
}

// ─── BUG-7: the guarded write ─────────────────────────────────────────────────
// Exported so the acceptance fixture can exercise a raced write without a live
// Square connection — the race lives entirely in this function, and a test that
// could not call it would be testing a copy of the SQL rather than the SQL.
//
// WHAT REPLACED WHAT, and why the old shape could not be patched. This used to
// be deleteMany-then-createMany inside one transaction: check-then-act, where
// the delete was the check ("the day is clear now") and nothing held that true
// until the insert. Two writers for one store-day therefore collided on
// @@unique([storeId, date]) — BUG-7's P2002 — and, worse, whichever COMMITTED
// last won, which is not the same as whichever READ SQUARE last.
//
// `syncedAt` now carries the instant Square was READ (fetchStartedAt), and the
// ON CONFLICT ... WHERE clause makes the write conditional on that instant
// being newer than what is stored. So:
//   - Two writers never collide: ON CONFLICT DO UPDATE takes the row lock, so
//     the second blocks until the first commits and then re-evaluates against
//     the COMMITTED value. There is no window to insert into.
//   - The older FETCH loses even when it commits later, and loses silently and
//     correctly — a row whose WHERE is false is skipped and is not RETURNED,
//     which is exactly the signal this function needs.
//   - Winning the period row also serialises the rest of the transaction for
//     that store-day: a concurrent writer is parked on that same row lock, so
//     the hourly/line rewrite below needs no guard of its own.
// Hence the ordering here is load-bearing — the period upsert MUST come first.
export async function writeSalesCache(
  org: Organization,
  store: Store,
  fetchStartedAt: Date,
  dateStrs: string[],
  byDay: Map<string, DayAgg>,
  byHour: Map<string, HourAgg>,
  byLine: Map<string, LineAgg>
): Promise<{ written: string[]; discarded: string[] }> {
  // Sorted so every writer takes its row locks in the same order. Unsorted, two
  // writers whose spillover dates differ could take them in opposite orders and
  // deadlock. `dates` is a Set upstream, so there are no duplicate keys — which
  // ON CONFLICT would reject outright ("cannot affect row a second time").
  const ordered = [...dateStrs].sort()
  if (ordered.length === 0) return { written: [], discarded: [] }

  const values = ordered.map((dateStr) => {
    const day = byDay.get(dateStr) ?? emptyDayAgg()
    // `id` has no database default on this table (Prisma generates cuid
    // client-side), so a raw INSERT has to supply one. A uuid here sits beside
    // cuids written before BUG-7; the column is a bare primary key that no
    // foreign key references and no response ever exposes, so the two formats
    // never meet. `syncedAt` likewise has a CURRENT_TIMESTAMP default that
    // would otherwise stamp insert time and defeat the whole point.
    return Prisma.sql`(${randomUUID()}, ${org.id}, ${store.id}, ${dateStr}::date,
      ${day.gross}, ${day.net}, ${day.unconfirmed}, ${day.tax}, ${day.tip},
      ${day.discount}, ${day.orders}, ${fetchStartedAt})`
  })

  return prisma.$transaction(async (tx) => {
    const won = await tx.$queryRaw<{ date: Date }[]>`
      INSERT INTO "SalesPeriodCache" (
        "id", "organizationId", "storeId", "date", "grossSales", "netSales",
        "unconfirmedNet", "taxTotal", "tipTotal", "discountTotal", "orderCount", "syncedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("storeId", "date") DO UPDATE SET
        "grossSales"     = EXCLUDED."grossSales",
        "netSales"       = EXCLUDED."netSales",
        "unconfirmedNet" = EXCLUDED."unconfirmedNet",
        "taxTotal"       = EXCLUDED."taxTotal",
        "tipTotal"       = EXCLUDED."tipTotal",
        "discountTotal"  = EXCLUDED."discountTotal",
        "orderCount"     = EXCLUDED."orderCount",
        "syncedAt"       = EXCLUDED."syncedAt"
      WHERE "SalesPeriodCache"."syncedAt" < EXCLUDED."syncedAt"
      RETURNING "date"
    `

    const writtenSet = new Set(won.map((r) => r.date.toISOString().slice(0, 10)))
    const written = ordered.filter((d) => writtenSet.has(d))
    const discarded = ordered.filter((d) => !writtenSet.has(d))
    if (written.length === 0) return { written, discarded }

    // Only the days this writer won. A discarded day keeps the winner's hourly
    // and line rows untouched — deleting them would strip detail off a total
    // this writer just declined to overwrite.
    const wonDates = written.map(dbDate)

    // Still delete-then-insert, and still correct: the period-row lock above is
    // held for the rest of this transaction, so no concurrent writer can be
    // between these statements. Delete is what removes an hour or a variation
    // that existed in the previous write and does not exist in this one —
    // an upsert alone would leave those rows behind as phantoms.
    await tx.salesHourlyCache.deleteMany({ where: { storeId: store.id, date: { in: wonDates } } })
    await tx.salesLineCache.deleteMany({ where: { storeId: store.id, date: { in: wonDates } } })

    const hourRows = [...byHour.entries()]
      .map(([key, v]) => {
        const [dateStr, hourStr] = key.split("|")
        return { dateStr, hour: Number(hourStr), v }
      })
      .filter((r) => writtenSet.has(r.dateStr))
    if (hourRows.length > 0) {
      await tx.salesHourlyCache.createMany({
        data: hourRows.map((r) => ({
          organizationId: org.id,
          storeId: store.id,
          date: dbDate(r.dateStr),
          hour: r.hour,
          netSales: r.v.net,
          orderCount: r.v.orders,
        })),
      })
    }

    const lineRows = [...byLine.entries()]
      .map(([key, v]) => {
        const [dateStr, variationId] = key.split("|")
        return { dateStr, variationId, v }
      })
      .filter((r) => writtenSet.has(r.dateStr))
    if (lineRows.length > 0) {
      await tx.salesLineCache.createMany({
        data: lineRows.map((r) => ({
          organizationId: org.id,
          storeId: store.id,
          date: dbDate(r.dateStr),
          squareVariationId: r.variationId,
          quantitySold: r.v.qty,
          grossSales: r.v.gross,
        })),
      })
    }

    return { written, discarded }
  })
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

  // BUG-7: the instant this sync began READING Square. It becomes syncedAt, and
  // it is what orders two racing syncs — see writeSalesCache.
  //
  // Taken before the first page rather than after the last, deliberately. A
  // multi-page fetch reads later pages later, so start-time UNDERSTATES how
  // fresh the data is. That is the safe direction for every reader: understating
  // freshness costs one extra refresh, overstating it means a refresh that
  // should have happened does not. It is also the only instant that is true of
  // the whole window rather than of its last page.
  const fetchStartedAt = new Date()

  const startAt = localMidnightUtc(startDate, tz)
  const endNext = new Date(`${endDate}T00:00:00.000Z`)
  endNext.setUTCDate(endNext.getUTCDate() + 1)
  const endAt = localMidnightUtc(endNext.toISOString().slice(0, 10), tz)

  // Shapes exported above so writeSalesCache and the fixture share one
  // definition rather than three hand-copied ones (DEBT-32's lesson).
  const byDay = new Map<string, DayAgg>()
  const byHour = new Map<string, HourAgg>() // `${date}|${hour}`
  const byLine = new Map<string, LineAgg>() // `${date}|${variationId}`

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
            // OPEN + COMPLETED, then require a tender in code (see below). Square
            // counts a sale the moment it's PAID, not when the order is marked
            // complete — auto-accepted delivery orders sit OPEN-but-paid until
            // fulfilled, and Square already counts them. CANCELED/DRAFT are
            // excluded here; DRAFT has no tender anyway.
            state_filter: { states: ["OPEN", "COMPLETED"] },
            date_time_filter: {
              // Bucket by created_at — Square's Sales Summary reports sales on
              // the day the order was OPENED, not closed. Filtering/bucketing by
              // closed_at threw delivery/online orders (opened one day, closed
              // the next) into the wrong reporting day. Verified: created_at +
              // paid reconciles to Square's Net Sales to the penny.
              created_at: { start_at: startAt.toISOString(), end_at: endAt.toISOString() },
            },
          },
          sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`SQUARE_SEARCH_ORDERS_FAILED:${res.status}:${text.slice(0, 300)}`)
    }

    const data = (await res.json()) as { orders?: SquareOrder[]; cursor?: string }
    for (const order of data.orders ?? []) {
      if (!order.created_at) continue
      // Count a sale only once it's PAID (has a tender). Skips unpaid open tabs
      // and drafts — Square doesn't count those either. This matches Square on
      // the live day (paid delivery orders still OPEN are included) and on
      // settled days (where paid == completed, verified to the penny).
      if (!order.tenders || order.tenders.length === 0) continue
      const instant = new Date(order.created_at)
      const { dateStr, hour } = localParts(instant, tz)
      // An order can be created a few minutes either side of local midnight,
      // landing on a date outside the requested window — keep it; its day gets
      // rewritten too.

      // total_money is what was collected — it includes tax AND tips. The
      // sales metric excludes both (matches Square's "Net Sales" definition);
      // net = total − tax − tip. Third-party delivery orders (DoorDash, Uber
      // Eats, Orda, etc.) are COMPLETED orders and ARE counted here — delivery
      // revenue is intentionally included in the goal metric.
      const gross = dollars(order.total_money)
      const tax = dollars(order.total_tax_money)
      const tip = dollars(order.total_tip_money)
      const discount = dollars(order.total_discount_money)
      const net = gross - tax - tip

      const day = byDay.get(dateStr) ?? emptyDayAgg()
      day.gross += gross
      day.net += net
      day.tax += tax
      day.tip += tip
      day.discount += discount
      day.orders += 1
      // Paid but still OPEN in Square = confirmed as a sale, but the ticket
      // hasn't been closed out in the POS yet. Surfaced as a "not confirmed"
      // teaser so stores know there are open tickets to reconcile.
      if (order.state === "OPEN") day.unconfirmed += net
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

  // BUG-7: the write is guarded — a day whose stored syncedAt is newer than
  // this sync's fetchStartedAt is left alone rather than overwritten, and two
  // concurrent syncs can no longer collide. See writeSalesCache.
  const { written, discarded } = await writeSalesCache(
    org,
    store,
    fetchStartedAt,
    [...dates],
    byDay,
    byHour,
    byLine
  )

  if (discarded.length > 0) {
    // Not an error and not a retry case: a newer read of Square already wrote
    // these days, so this sync's numbers are the stale ones. Logged because a
    // sustained rate here means something is scheduling far more syncs than it
    // needs to (BUG-7's companion row on coalescing).
    console.log(
      `[sales-sync] store=${store.id} wrote ${written.length}/${dates.size} day(s); ` +
        `discarded ${discarded.length} superseded by a newer fetch: ${discarded.join(",")}`
    )
  }

  return {
    storeId: store.id,
    startDate,
    endDate,
    orders: orderCount,
    days: written.length,
    discardedDays: discarded.length,
  }
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
