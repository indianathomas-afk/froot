// Recommended staff-on-floor by hour (Phase 3, guidance only). PURE — turns a
// day's HOURLY budget + demand shape into an integer headcount step line that
// is DEMAND-SHAPED and BUDGET-CAPPED (no fixed daypart minimums). The salaried
// GM counts as a body + the supervisor during their on-floor window. Floor of 1
// while open (opener/closer). No DB — unit-testable.

export type HourNet = { hour: number; net: number }

export type CoveragePoint = {
  hour: number
  headcount: number // total on floor = hourly + GM
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
  supervisorGap: boolean // open hours outside the GM window with no hourly supervisor
}

// hourlyBudgetHours: the day's hourly person-hours (post daily-split + adjustment).
// The GM is salaried and counted separately — NOT from this budget.
// gmWindow: the GM's on-floor window (end exclusive), or null if no GM.
// hasHourlySupervisor: is there an active hourly supervisory position to cover
// the hours the GM isn't on the floor.
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
  // Floor: at least 1 TOTAL body every open hour (the GM can be that body).
  for (const h of openHours) {
    const total = (hourly.get(h) ?? 0) + (gmAt(h) ? 1 : 0)
    if (total < 1) hourly.set(h, 1)
  }

  const usedHourlyHours = openHours.reduce((s, h) => s + (hourly.get(h) ?? 0), 0)

  const points: CoveragePoint[] = []
  for (let h = 0; h < 24; h++) {
    const isOpen = h >= openStart && h < openEnd
    const hh = isOpen ? hourly.get(h) ?? 0 : 0
    const gm = isOpen && gmAt(h)
    points.push({ hour: h, hourly: hh, gm, headcount: hh + (gm ? 1 : 0), open: isOpen })
  }

  const openPts = points.filter((p) => p.open)
  const peakHeadcount = Math.max(...openPts.map((p) => p.headcount))
  const peakHours = openPts.filter((p) => p.headcount === peakHeadcount).map((p) => p.hour)

  // Supervisor: the GM covers its window; any open hour outside it needs an
  // hourly supervisory position to exist.
  const openOutsideGm = openHours.some((h) => !gmAt(h))
  const supervisorGap = openOutsideGm && !hasHourlySupervisor

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
    // sums to the budget); 0.5 tolerance absorbs rounding.
    understaffedBudget: usedHourlyHours > hourlyBudgetHours + 0.5,
    gmWindow: gmWindow ? { startHour: gmWindow.startHour, endHour: gmWindow.endHour } : null,
    supervisorGap,
  }
}
