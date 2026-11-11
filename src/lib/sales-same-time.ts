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
//   - TAB-7 fix (Gary, 2026-11-11): a RANGE ending today compares with the
//     matching comparison window, its last day cut the same way
//     (compareWindowEndingToday). A range ending before today is unchanged.
//     compareSelection is the single entry point that picks between these.
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

/** One cached day of a comparison window (SalesPeriodCache). */
export type WindowDay = { date: string; total: number; orders: number }

/**
 * TAB-7 fix (Gary, 2026-11-11: "Cut it."). A RANGE that ends today (This
 * week, Month to date, any range that includes today) is compared with the
 * matching comparison window whose LAST day is cut at the same time of day,
 * through compareTodayWithDay. Every earlier day of the window counts in
 * full. A range that ends before today is unchanged.
 *
 *   days        the comparison window's cached days (any order)
 *   lastDate    the comparison window's last date (yyyy-mm-dd)
 *   lastHourly  that last date's hourly rows
 *
 * The method and the "by 10:15 AM" / "(full day)" label are the last day's.
 * Last day not cached: earlier days only, method "full-day" (nothing was cut
 * — the window has no partial day to cut). Nothing cached: null.
 */
export function compareWindowEndingToday(
  days: WindowDay[],
  lastDate: string,
  lastHourly: HourRow[],
  now: LocalTime
): DayComparison | null {
  if (days.length === 0) return null
  const earlier = days.filter((d) => d.date !== lastDate)
  const lastRow = days.find((d) => d.date === lastDate) ?? null
  const last = compareTodayWithDay(
    lastRow ? { total: lastRow.total, orders: lastRow.orders, hourly: lastHourly } : null,
    true,
    now
  )
  const net = round2(earlier.reduce((s, d) => s + d.total, 0) + (last?.net ?? 0))
  const orders = Math.round((earlier.reduce((s, d) => s + d.orders, 0) + (last?.orders ?? 0)) * 100) / 100
  return last
    ? { method: last.method, net, orders, asOf: last.asOf, asOfLabel: last.asOfLabel }
    : { method: "full-day", net, orders, asOf: null, asOfLabel: null }
}

/**
 * Which comparison a selection gets — the whole rule in one place, so the
 * route only loads rows (TAB-7 + fix):
 *   single day, today            → same time of day
 *   single day, past             → full day
 *   range ending today           → window with its last day cut (above)
 *   range ending before today    → null: window totals, unchanged
 */
export function compareSelection(
  sel: { start: string; end: string; today: string },
  comp: { start: string; end: string; days: WindowDay[]; lastHourly: HourRow[] },
  now: LocalTime
): DayComparison | null {
  if (sel.start === sel.end) {
    const day = comp.days.find((d) => d.date === comp.start)
    return compareTodayWithDay(
      day ? { total: day.total, orders: day.orders, hourly: comp.lastHourly } : null,
      sel.start === sel.today,
      now
    )
  }
  if (sel.end !== sel.today) return null
  return compareWindowEndingToday(comp.days, comp.end, comp.lastHourly, now)
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
