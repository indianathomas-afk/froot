// Recommended staff-on-floor by hour (Phase 3, guidance only). PURE — turns a
// day's HOURLY budget + demand shape into an integer headcount step line that
// is DEMAND-SHAPED and BUDGET-CAPPED (no fixed daypart minimums). The salaried
// manager is DRAWN on floor during her window but does NOT satisfy the floor of 1,
// does NOT clear supervisorGap (R7-D), and since 2026-08-23 is NOT in `headcount`
// either — the band is an EXPECTATION, and her CREDITED hours enter Suggested once
// per day through suggestedHoursForDay. Floor of 1 HOURLY head while open
// (opener/closer). No DB — unit-testable.

export type HourNet = { hour: number; net: number }

export type CoveragePoint = {
  hour: number
  headcount: number // HOURLY heads on floor. The manager is DRAWN (`gm`) and is NOT in this number — 2026-08-23 ruling
  hourly: number // hourly heads (what the budget pays for)
  gm: boolean // GM on floor this hour
  open: boolean
}

export type CoverageResult = {
  points: CoveragePoint[] // one per hour 0–23
  openHours: number[]
  openStart: number
  openEnd: number // exclusive
  peakHours: number[]
  peakHeadcount: number
  hourlyBudgetHours: number // the day's hourly person-hours (the cap)
  usedHourlyHours: number // hourly heads actually recommended
  understaffedBudget: boolean // floor-1 forced hourly above the budget
  gmWindow: { startHour: number; endHour: number } | null
  supervisorGap: boolean // open with no hourly supervisory position (the GM does not clear it)
}

// hourlyBudgetHours: the day's hourly person-hours (post daily-split + adjustment).
// The GM is salaried and counted separately — NOT from this budget.
// gmWindow: the GM's on-floor window (end exclusive), or null if no GM.
// hasHourlySupervisor: is there an active hourly supervisory position. Since
// R7-D this ALONE decides supervisorGap — the GM's window does not cover for it.
export function computeDailyCoverage({
  hourlyBudgetHours,
  demand,
  open,
  gmWindow,
  hasHourlySupervisor,
}: {
  hourlyBudgetHours: number
  demand: HourNet[]
  open: { startHour: number; endHour: number } | null
  gmWindow: { startHour: number; endHour: number } | null
  hasHourlySupervisor: boolean
}): CoverageResult | null {
  // Operating window — from StoreHours, else inferred from demand.
  let openStart: number
  let openEnd: number
  if (open && open.endHour > open.startHour) {
    openStart = open.startHour
    openEnd = open.endHour
  } else {
    const withDemand = demand.filter((d) => d.net > 0).map((d) => d.hour)
    if (withDemand.length === 0) return null
    openStart = Math.min(...withDemand)
    openEnd = Math.max(...withDemand) + 1
  }
  const openHours: number[] = []
  for (let h = openStart; h < openEnd; h++) openHours.push(h)
  if (openHours.length === 0) return null

  const netByHour = new Map(demand.map((d) => [d.hour, d.net]))
  const totalNet = openHours.reduce((s, h) => s + (netByHour.get(h) ?? 0), 0)
  const gmAt = (h: number) => !!gmWindow && h >= gmWindow.startHour && h < gmWindow.endHour

  // Distribute the hourly budget across open hours proportional to demand — this
  // is the demand-shaped headcount, capped by the budget. Largest-remainder so
  // the integer heads sum to ~the budget (per-hour rounding would inflate it).
  const target = Math.round(hourlyBudgetHours) // total hourly person-hours to place
  const alloc = openHours.map((h) => {
    const weight = totalNet > 0 ? (netByHour.get(h) ?? 0) / totalNet : 1 / openHours.length
    const val = target * weight
    return { h, n: Math.floor(val), frac: val - Math.floor(val) }
  })
  let remaining = target - alloc.reduce((s, a) => s + a.n, 0)
  for (const a of [...alloc].sort((x, y) => y.frac - x.frac)) {
    if (remaining <= 0) break
    a.n++
    remaining--
  }
  const hourly = new Map(alloc.map((a) => [a.h, a.n]))
  // Floor: at least 1 HOURLY body every open hour. R7-D — THE GM DOES NOT
  // SATISFY THIS FLOOR. Froot does not know which hours the GM is at which
  // store: the only stores in the estate that draw a band share one GM at a
  // part allocation each, so counting her as a present body is wrong in the
  // direction that leaves a store EMPTY. The band still DRAWS (points[].gm
  // below is untouched) — it just no longer stands in for an opener/closer.
  for (const h of openHours) {
    if ((hourly.get(h) ?? 0) < 1) hourly.set(h, 1)
  }

  const usedHourlyHours = openHours.reduce((s, h) => s + (hourly.get(h) ?? 0), 0)

  const points: CoveragePoint[] = []
  for (let h = 0; h < 24; h++) {
    const isOpen = h >= openStart && h < openEnd
    const hh = isOpen ? hourly.get(h) ?? 0 : 0
    const gm = isOpen && gmAt(h)
    // MANAGER ON THE FLOOR (Gary, 2026-08-23) — `headcount` is HOURLY HEADS ONLY.
    // The band still draws (`gm` below is untouched) but it no longer contributes a
    // body to any number: Froot knows the manager is worth 20 hours a week at each
    // of two stores and does NOT know WHICH 20 (that is L-4), so the window says
    // when she is EXPECTED, not what she covers. Her CREDITED hours are added back
    // once per DAY by suggestedHoursForDay below — not once per band hour.
    points.push({ hour: h, hourly: hh, gm, headcount: hh, open: isOpen })
  }

  // PEAK IS NOW THE HOURLY PEAK, and that is intended rather than incidental —
  // `headcount` is hourly heads since the 2026-08-23 ruling. No compensating term.
  const openPts = points.filter((p) => p.open)
  const peakHeadcount = Math.max(...openPts.map((p) => p.headcount))
  const peakHours = openPts.filter((p) => p.headcount === peakHeadcount).map((p) => p.hour)

  // Supervisor: an open day needs an hourly supervisory position to exist.
  // R7-D — THE GM'S WINDOW NO LONGER SUPPRESSES THIS. It used to, via
  // `openHours.some((h) => !gmAt(h))`, so a band spanning the whole open window
  // cleared the flag outright. Same reason as the floor above: a GM shared
  // across stores is not known to be at this one, and a suppressed gap is a
  // store told it is covered when it may not be.
  const supervisorGap = !hasHourlySupervisor

  return {
    points,
    openHours,
    openStart,
    openEnd,
    peakHours,
    peakHeadcount,
    hourlyBudgetHours,
    usedHourlyHours,
    // Only the floor-1 bumps can push hourly above budget (demand distribution
    // sums to the budget); 0.5 tolerance absorbs rounding. Since R7-D those
    // bumps also fire INSIDE the GM band, so this flags more often at a GM
    // store — the hours were always needed and the GM was papering over them.
    understaffedBudget: usedHourlyHours > hourlyBudgetHours + 0.5,
    gmWindow: gmWindow ? { startHour: gmWindow.startHour, endHour: gmWindow.endHour } : null,
    supervisorGap,
  }
}

// ── Demand-shape source (PURE) ────────────────────────────────────────────────
// Date helpers for the classifier below. `labor-plan` re-exports both, so every
// existing `@/lib/labor-plan` import site is unchanged; they live here so the
// classifier stays in a module with no DB import and the verify script can
// exercise it without a database.
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export function jsDowOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay() // 0 Sun..6 Sat
}

export type DemandShapeSource = {
  // The date whose own SalesHourlyCache shapes the day — a COMPLETED past day
  // only. null for today and future days, which take the template.
  actualsDate: string | null
  // The four completed same-weekday dates averaged into the template shape.
  // Also the fallback when a past day has no cache. NEVER contains `today`.
  templateDates: string[]
}

// Which slice of the sales cache shapes a given day. `date` and `today` are
// STORE-LOCAL yyyy-mm-dd (callers derive `today` from localDateStr +
// store.timezone), so the boundary is the store's day, not UTC's.
//
// Ruled 2026-08-19 (docs/DECISIONS.md, "Same-day coverage shape"): the current
// day uses the future-day template, never its own partial-day cache — today's
// cache holds only ELAPSED hours, and shaping the whole day's budget by it
// crams the day into the morning and leaves post-now hours at floor-1. Past
// days keep their own complete cache; when today becomes yesterday the card
// flips to actuals, and that flip is intended.
export function demandShapeSource(date: string, today: string): DemandShapeSource {
  const targetWd = jsDowOf(date)
  // Walk back from YESTERDAY so the window is the last four COMPLETED same
  // weekdays. Anchoring at `today` (as this walk used to) folds today's partial
  // day into the average whenever the target weekday is today's — the same
  // contamination, and it would make today's curve differ from the one
  // yesterday's future-day view drew for it.
  let cursor = addDaysStr(today, -1)
  for (let i = 0; i < 7 && jsDowOf(cursor) !== targetWd; i++) cursor = addDaysStr(cursor, -1)
  return {
    actualsDate: date < today ? date : null,
    templateDates: [0, 7, 14, 21].map((k) => addDaysStr(cursor, -k)),
  }
}

// SUGGESTED HOURS FOR ONE DAY — the pure seam the weekly-plan route sums over.
//
// Suggested still counts the WHOLE CREW including the manager (Gary's 2026-08-20
// ruling is untouched); what changed on 2026-08-23 is the INSTRUMENT. It used to
// read one manager body per drawn band hour, which at the unset default
// (`open.startHour` → the hardcoded 14, DEBT-83) is ~6-7 hours a day across
// SEVEN days for a person who works five. It now reads `gmCreditHours` — the
// day's credited hours, which `capGmFloorCredits` has already scaled so the week
// sums to her allocation.
//
// THE WEEKLY IDENTITY THIS RESTS ON: Σ credited = min(B, C), where B is the drawn
// band's weekly hours and C the ceiling from her allocation. So Suggested falls by
// exactly max(0, B − C) — the amount the drawn band exceeded what she is credited
// for — and does not move at all where B ≤ C (`labor-daily.ts:54` returns the band
// unscaled; that is S5-D10's second case and it is open by ruling).
//
// `gmCreditHours` is 0 at every store with no allocated person (`hasGm` false, so
// no band is ever built), which makes this a byte-for-byte no-op at ten of twelve.
export function suggestedHoursForDay(points: CoveragePoint[], gmCreditHours: number): number {
  return points.filter((p) => p.open).reduce((sum, p) => sum + p.headcount, 0) + gmCreditHours
}
