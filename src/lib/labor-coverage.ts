// Recommended staff-on-floor by hour (Phase 2, guidance only). PURE — turns a
// day's already-adjusted hourly person-hours + demand shape + store hours +
// daypart rules into an integer headcount step line that satisfies the
// minimum-staffing rules. No DB — unit-testable (scripts/verify-labor-coverage.ts).

export type HourNet = { hour: number; net: number }

export type DaypartRule = {
  name: string
  startHour: number // inclusive
  endHour: number // exclusive
  minHeadcount: number
  requiresSupervisor: boolean
}

export type CoveragePoint = { hour: number; headcount: number; open: boolean }

export type DaypartCoverage = {
  name: string
  minHeadcount: number
  requiresSupervisor: boolean
  metMin: boolean
}

export type CoverageResult = {
  points: CoveragePoint[] // one per hour 0–23 (headcount 0 when closed)
  openHours: number[]
  peakHours: number[]
  peakHeadcount: number
  dayHours: number // person-hours budgeted for the day (post-adjustment)
  usedPersonHours: number // person-hours the recommendation actually uses
  exceedsDayHours: boolean // min-staffing floors pushed past the budget
  supervisorShortfall: boolean // a daypart needs a supervisor but none is defined
  dayparts: DaypartCoverage[]
}

// dayHours: the day's HOURLY person-hours after the day split + adjustment.
// open: the store's operating window for that day ({startHour, endHour}, end
// exclusive) from StoreHours; null → infer the window from the demand shape.
export function computeDailyCoverage({
  dayHours,
  hourly,
  open,
  dayparts,
  hasSupervisoryPosition,
}: {
  dayHours: number
  hourly: HourNet[]
  open: { startHour: number; endHour: number } | null
  dayparts: DaypartRule[]
  hasSupervisoryPosition: boolean
}): CoverageResult | null {
  // Operating window [openStart, openEnd) — from StoreHours, else inferred.
  let openStart: number
  let openEnd: number
  if (open && open.endHour > open.startHour) {
    openStart = open.startHour
    openEnd = open.endHour
  } else {
    const withSales = hourly.filter((h) => h.net > 0).map((h) => h.hour)
    if (withSales.length === 0) return null
    openStart = Math.min(...withSales)
    openEnd = Math.max(...withSales) + 1
  }
  const openHours: number[] = []
  for (let h = openStart; h < openEnd; h++) openHours.push(h)
  if (openHours.length === 0) return null

  const netByHour = new Map(hourly.map((h) => [h.hour, h.net]))
  const totalNet = openHours.reduce((s, h) => s + (netByHour.get(h) ?? 0), 0)
  const covering = (h: number) => dayparts.filter((d) => h >= d.startHour && h < d.endHour)

  // Distribute demand, then raise each hour to its min-staffing floor.
  const headByHour = new Map<number, number>()
  for (const h of openHours) {
    const weight = totalNet > 0 ? (netByHour.get(h) ?? 0) / totalNet : 1 / openHours.length
    const distributed = Math.round(dayHours * weight)
    const cov = covering(h)
    const daypartMin = cov.length ? Math.max(...cov.map((d) => d.minHeadcount)) : 1
    headByHour.set(h, Math.max(1, daypartMin, distributed))
  }

  const usedPersonHours = openHours.reduce((s, h) => s + (headByHour.get(h) ?? 0), 0)
  const peakHeadcount = Math.max(...openHours.map((h) => headByHour.get(h) ?? 0))
  const peakHours = openHours.filter((h) => headByHour.get(h) === peakHeadcount)

  const points: CoveragePoint[] = []
  for (let h = 0; h < 24; h++) {
    const isOpen = h >= openStart && h < openEnd
    points.push({ hour: h, headcount: isOpen ? headByHour.get(h) ?? 0 : 0, open: isOpen })
  }

  const daypartCov: DaypartCoverage[] = dayparts.map((d) => {
    const hrs = openHours.filter((h) => h >= d.startHour && h < d.endHour)
    return {
      name: d.name,
      minHeadcount: d.minHeadcount,
      requiresSupervisor: d.requiresSupervisor,
      metMin: hrs.length > 0 && hrs.every((h) => (headByHour.get(h) ?? 0) >= d.minHeadcount),
    }
  })

  // A daypart that requires a supervisor during open hours but no supervisory
  // position is defined → shortfall the UI warns on (we recommend headcount, not
  // people, so an existing supervisory position is assumed fillable).
  const needsSupervisor = dayparts.some(
    (d) => d.requiresSupervisor && openHours.some((h) => h >= d.startHour && h < d.endHour)
  )

  return {
    points,
    openHours,
    peakHours,
    peakHeadcount,
    dayHours,
    usedPersonHours,
    exceedsDayHours: usedPersonHours > dayHours + 0.01,
    supervisorShortfall: needsSupervisor && !hasSupervisoryPosition,
    dayparts: daypartCov,
  }
}
