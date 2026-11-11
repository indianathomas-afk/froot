// TAB-7 — today's sales against last year AT THE SAME TIME OF DAY.
//
// Before TAB-7 every "today vs last year" figure divided today's net sales SO
// FAR by the comparison day's WHOLE-DAY net, so at 8 AM a store on pace read
// "▼97.9%". This module is the ONE place that decides what today is compared
// with. Every surface that shows the comparison goes through
// `compareTodayWithDay`, so the desktop Sales Performance card
// (/api/dashboard/sales) and the tablet Sales tile and its expanded card
// (/api/dashboard/summary) cannot disagree.
//
// THE RULE (TAB-7 leans 1, 2, 5, 6):
//   - Selected day is NOT today (a finished past day): compare with the
//     comparison day's full-day total. Unchanged from before TAB-7.
//   - Selected day IS today, and the comparison day has hourly rows: compare
//     with the comparison day's hourly net for every hour BEFORE the current
//     store-local hour, plus the current hour's net × (minutes past ÷ 60).
//   - Today, the comparison day has a period row with sales but NO hourly rows
//     (a day cached before hourly existed, or a partial write): fall back to
//     the full day, and SAY SO ("full day"). Never silently mixed.
//   - No comparison day cached at all: no comparison.
//   - A baseline of $0 (before opening, a new store, a closed day) gives NO
//     percentage — callers render "—", never ∞% or ▼100%.
//
// Both caches are written in one transaction from one aggregation
// (src/lib/sales-sync.ts writeSalesCache), bucketed by each order's
// created_at in the STORE's zone, so Σ hourly = the day's net (TAB-7 audit:
// 0 of 2,425 dev days differ by more than a cent). That is what makes a sum of
// hours comparable with a period total.
//
// TIME ZONE (lean 8): "now" is the STORE's wall clock, never the server's.
// Hours are store-local wall-clock buckets on both days, with no shifting. On
// a DST change day the 1 AM bucket holds two real hours (fall back) or the
// 2 AM bucket does not exist (spring forward); the comparison is wall clock
// against wall clock, which is right for a store that is shut at 1–3 AM and
// slightly off for one that is not. Known limit, recorded in DECISIONS.
//
// PURE: no database, no Square, no fetch. The routes read the caches they
// already read and pass the rows in.

export type HourRow = { hour: number; net: number; orders?: number }

/** The store's wall clock: hour 0–23 and minute 0–59. */
export type LocalTime = { hour: number; minute: number }

export function storeLocalTime(instant: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0")
  // Some engines print midnight as "24" even under h23; fold it back.
  return { hour: get("hour") % 24, minute: get("minute") }
}

/** "10:15 AM" — the label form, from a store-local wall-clock time. */
export function formatTimeOfDay(t: LocalTime): string {
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12
  return `${h12}:${String(t.minute).padStart(2, "0")} ${t.hour < 12 ? "AM" : "PM"}`
}

/** Net and orders up to `at` on a day described by its hourly rows: every
 *  hour before `at.hour` in full, plus `at.hour` pro-rated by minutes past.
 *  Orders are pro-rated the same way, so they may be fractional. */
export function salesUpTo(hourly: HourRow[], at: LocalTime): { net: number; orders: number } {
  const frac = Math.min(Math.max(at.minute, 0), 59) / 60
  let net = 0
  let orders = 0
  for (const h of hourly) {
    const w = h.hour < at.hour ? 1 : h.hour === at.hour ? frac : 0
    if (w === 0) continue
    net += h.net * w
    orders += (h.orders ?? 0) * w
  }
  return { net: round2(net), orders: Math.round(orders * 100) / 100 }
}

export type ComparisonMethod =
  /** Today, compared with the comparison day up to the same time of day. */
  | "same-time"
  /** A finished day, compared with the comparison day's full day. */
  | "full-day"
  /** Today, but the comparison day has no hourly rows — full day, labelled. */
  | "full-day-fallback"

export type DayComparison = {
  method: ComparisonMethod
  /** The comparison figure today is measured against (net sales). */
  net: number
  /** Orders behind `net` — pro-rated on "same-time", so possibly fractional.
   *  Null when the caller passed no order count for the full day. */
  orders: number | null
  /** Store-local time the same-time figure runs to; null unless "same-time". */
  asOf: LocalTime | null
  /** "10:15 AM" for "same-time", else null. */
  asOfLabel: string | null
}

export type ComparisonDay = {
  /** The comparison day's SalesPeriodCache net. */
  total: number
  /** Its SalesPeriodCache orderCount, where the caller has it. */
  orders?: number
  /** Its SalesHourlyCache rows (any order). */
  hourly: HourRow[]
}

/**
 * THE ONE COMPARISON. `day` null = the comparison day isn't cached → null.
 *  isToday  — the selected day is the store's local today
 *  now      — the store's local wall clock (storeLocalTime(new Date(), tz))
 */
export function compareTodayWithDay(
  day: ComparisonDay | null,
  isToday: boolean,
  now: LocalTime
): DayComparison | null {
  if (!day) return null
  if (!isToday) {
    return { method: "full-day", net: day.total, orders: day.orders ?? null, asOf: null, asOfLabel: null }
  }
  // A period row that recorded sales but has no hourly rows can't be cut at a
  // time of day. A period row of $0 with no hourly rows is a day with no sales:
  // $0 by any time, which is a same-time $0 (→ "—"), not a fallback.
  if (day.hourly.length === 0 && (day.total !== 0 || (day.orders ?? 0) > 0)) {
    return { method: "full-day-fallback", net: day.total, orders: day.orders ?? null, asOf: null, asOfLabel: null }
  }
  const upTo = salesUpTo(day.hourly, now)
  return { method: "same-time", net: upTo.net, orders: upTo.orders, asOf: now, asOfLabel: formatTimeOfDay(now) }
}

/** Percentage change of `value` against `baseline`; null (render "—") when
 *  there is no positive baseline. One formula for every surface — the
 *  desktop DeltaPill's, which the tablet tile already mirrored. */
export function pctChange(value: number, baseline: number | null | undefined): number | null {
  if (baseline === null || baseline === undefined || !(baseline > 0)) return null
  return ((value - baseline) / baseline) * 100
}

/** The short suffix a surface appends to its existing "vs …" wording
 *  (lean 4): "by 10:15 AM", "(full day)", or nothing on a finished day. */
export function comparisonSuffix(c: Pick<DayComparison, "method" | "asOfLabel">): string {
  if (c.method === "same-time") return `by ${c.asOfLabel}`
  if (c.method === "full-day-fallback") return "(full day)"
  return ""
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
