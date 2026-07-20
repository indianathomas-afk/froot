// Recommended staff-on-floor by hour (Phase 1B, guidance only). PURE — turns a
// day's hourly-sales demand shape + the day's slice of the weekly schedulable
// hours into an integer headcount step line. Deliberately simple and heavily
// commented so the heuristic is easy to tune later.

export type HourNet = { hour: number; net: number }

export type CoveragePoint = { hour: number; headcount: number; open: boolean }

export type CoverageResult = {
  points: CoveragePoint[] // one per hour 0–23 (headcount 0 when closed)
  openHours: number[] // the operating window, inclusive of interior dips
  peakHours: number[] // hours tied for the max headcount
  dayHours: number // person-hours allocated to this day
  peakHeadcount: number
}

// ── The single tunable heuristic ────────────────────────────────────────────
// dayShareOfWeek: this day's share of the week's sales (0–1). The caller
// computes it from actuals (day net ÷ week net), falling back to an even split.
// We hand it in so the weekly→daily split lives in ONE clearly-labeled place.
export function recommendCoverage({
  hourly,
  dayShareOfWeek,
  totalSchedulableHours,
}: {
  hourly: HourNet[]
  dayShareOfWeek: number
  totalSchedulableHours: number
}): CoverageResult | null {
  // Operating window = first..last hour with any sales, keeping interior hours
  // continuous (a mid-day dip to $0 stays "open" and floored to 1).
  const withSales = hourly.filter((h) => h.net > 0).map((h) => h.hour)
  if (withSales.length === 0) return null
  const openStart = Math.min(...withSales)
  const openEnd = Math.max(...withSales)
  const openHours: number[] = []
  for (let h = openStart; h <= openEnd; h++) openHours.push(h)

  const netByHour = new Map(hourly.map((h) => [h.hour, h.net]))
  const totalNet = openHours.reduce((s, h) => s + (netByHour.get(h) ?? 0), 0)

  // Person-hours allocated to this day, then distributed across open hours
  // proportional to demand; each 1-hour bucket's person-hours == avg headcount.
  const dayHours = totalSchedulableHours * dayShareOfWeek

  const headByHour = new Map<number, number>()
  for (const h of openHours) {
    const weight = totalNet > 0 ? (netByHour.get(h) ?? 0) / totalNet : 1 / openHours.length
    // Floor of 1 whenever the store is open — never recommend an empty floor.
    headByHour.set(h, Math.max(1, Math.round(dayHours * weight)))
  }

  const peakHeadcount = Math.max(...openHours.map((h) => headByHour.get(h) ?? 0))
  const peakHours = openHours.filter((h) => headByHour.get(h) === peakHeadcount)

  const points: CoveragePoint[] = []
  for (let h = 0; h < 24; h++) {
    const open = h >= openStart && h <= openEnd
    points.push({ hour: h, headcount: open ? headByHour.get(h) ?? 0 : 0, open })
  }

  return { points, openHours, peakHours, dayHours, peakHeadcount }
}
