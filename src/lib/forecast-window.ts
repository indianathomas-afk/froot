import { daysInMonth } from "@/lib/pacing"

// ─── Forecast read window (PERM-3) ───────────────────────────────────────────
// The MANAGER forecast horizon: the current month plus the next. Pure — no DB,
// no next/server, no Intl — so the API guards AND the client year selector can
// import the SAME definition. Two copies of this month arithmetic would drift,
// and month-end is exactly when a drift would bite.
//
// Callers pass a store-local `today` (yyyy-mm-dd) rather than a Date, which is
// what keeps this function pure: the timezone lookup stays at the call site
// (localDateStr(new Date(), store.timezone)) and must be redone PER REQUEST —
// never hoisted to a module constant or cached across a month boundary.
//
// Every date in this codebase is a zero-padded ISO string, whose lexicographic
// order IS chronological. So "the first instant of the current month through
// the last instant of next month" is expressed exactly as the inclusive string
// comparison start <= date <= end, with no instant arithmetic and no DST or
// off-by-one exposure at the boundary.

export type ForecastWindow = {
  start: string // yyyy-mm-dd — first day of the current month (inclusive)
  end: string // yyyy-mm-dd — last day of the next month (inclusive)
  months: string[] // yyyy-mm — the whole months the window covers
}

export function forecastWindowFrom(today: string, monthsAhead = 1): ForecastWindow {
  const [y, m] = today.slice(0, 7).split("-").map(Number)
  const months: string[] = []
  for (let i = 0; i <= monthsAhead; i++) {
    // Month index math on a 0-based month, so December (m=12, i=1) rolls to
    // January of y+1 — the case that matters most, since a manager budgeting
    // in December is the primary use case for this window.
    const total = (m - 1) + i
    const year = y + Math.floor(total / 12)
    const month = (total % 12) + 1
    months.push(`${year}-${String(month).padStart(2, "0")}`)
  }
  const last = months[months.length - 1]
  return {
    start: `${months[0]}-01`,
    end: `${last}-${String(daysInMonth(`${last}-01`)).padStart(2, "0")}`,
    months,
  }
}

// Inclusive membership for a yyyy-mm-dd date.
export function isDateInWindow(dateStr: string, w: ForecastWindow): boolean {
  return dateStr >= w.start && dateStr <= w.end
}

// Membership for a whole yyyy-mm month. The window is month-aligned, so any
// calendar month is entirely inside it or entirely outside — never split.
export function isMonthInWindow(month: string, w: ForecastWindow): boolean {
  return w.months.includes(month)
}

// Years the window touches, ascending — 1 year normally, 2 in December. The
// forward edge of the year selector derives from THIS, never from the calendar
// year, so December offers next January's year.
export function windowYears(w: ForecastWindow): number[] {
  return [...new Set(w.months.map((mo) => Number(mo.slice(0, 4))))].sort((a, b) => a - b)
}
