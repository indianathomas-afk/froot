// Pure daily-hours helpers (Phase 2). Salaried hours are a weekly constant and
// are NOT split per day — only the weekly HOURLY hours are distributed, then
// optionally scaled by a per-day adjustment. No DB — unit-testable.

export type DaySplit = { weekday: number; hourlyHours: number }

// Distribute weekly hourly hours across weekdays by basis-point weights,
// flooring each day to the nearest 0.5 hr (conservative, matches the budget).
// weightsByWeekday: 7 numbers, index 0=Mon … 6=Sun, in basis points (sum ≈
// 10000). openDays: weekday indices the store is open (even-split fallback when
// weights are absent/zero).
export function splitWeeklyHoursToDays({
  weeklyHourlyHours,
  weightsByWeekday,
  openDays,
}: {
  weeklyHourlyHours: number
  weightsByWeekday: number[] | null
  openDays: number[]
}): DaySplit[] {
  const days = [0, 1, 2, 3, 4, 5, 6]
  const totalBps = weightsByWeekday ? weightsByWeekday.reduce((s, w) => s + Math.max(0, w), 0) : 0
  const useWeights = !!weightsByWeekday && totalBps > 0

  return days.map((weekday) => {
    let share: number
    if (useWeights) {
      share = Math.max(0, weightsByWeekday![weekday] ?? 0) / totalBps
    } else {
      const pool = openDays.length > 0 ? openDays : days
      share = pool.includes(weekday) ? 1 / pool.length : 0
    }
    return { weekday, hourlyHours: Math.floor(weeklyHourlyHours * share * 2) / 2 }
  })
}

// Scale a day's HOURLY hours by an adjustment percent (e.g. -20 = staff 20%
// below), flooring to 0.5 and clamping at 0. Salaried is untouched by callers.
export function applyDayAdjustment(dayHourlyHours: number, adjustmentPct: number): number {
  const scaled = dayHourlyHours * (1 + adjustmentPct / 100)
  return Math.max(0, Math.floor(scaled * 2) / 2)
}

// L-3: cap the GM's weekly COUNTED floor coverage. `gmHoursByWeekday` is the
// GM's on-floor hours per weekday (window ∩ open hours), 0 for closed / no-GM
// days. Returns the credited GM floor-hours per day, scaled proportionally so
// the weekly total never exceeds `weeklyCap` (default 40) — the model can't
// lean on hours the GM doesn't work. WHICH specific days the GM is off is the
// assignment layer (L-4); L-3 only caps the weekly TOTAL, so the scaling is
// deliberately day-agnostic. Below the cap it returns the hours unchanged.
export function capGmFloorCredits(gmHoursByWeekday: number[], weeklyCap = 40): number[] {
  const nonNeg = gmHoursByWeekday.map((h) => Math.max(0, h))
  const total = nonNeg.reduce((s, h) => s + h, 0)
  if (total <= weeklyCap || total <= 0) return nonNeg
  const scale = weeklyCap / total
  return nonNeg.map((h) => h * scale)
}

// L-3 floor-first daily split — the NEW DEFAULT. Guarantee each open day enough
// hourly hours to cover its minimum floor (one body every open hour, minus the
// GM's capped on-floor credit) BEFORE distributing the remainder by sales
// weight. `floorHoursByWeekday` is 7 numbers (index 0=Mon … 6=Sun): each open
// day's floor requirement = max(0, openHours − cappedGmCredit); 0 for closed
// days. `weightsByWeekday` (bps) shapes the remainder only. Everything floors
// to 0.5 hr so the per-day sum never exceeds the weekly total (the invariant
// the sales-weighted split also holds). Salaried is a weekly constant — never
// split (callers handle salaried separately), same as splitWeeklyHoursToDays.
export function splitWeeklyHoursToDaysFloorFirst({
  weeklyHourlyHours,
  weightsByWeekday,
  floorHoursByWeekday,
}: {
  weeklyHourlyHours: number
  weightsByWeekday: number[] | null
  floorHoursByWeekday: number[]
}): DaySplit[] {
  const days = [0, 1, 2, 3, 4, 5, 6]
  const floor = days.map((d) => Math.max(0, floorHoursByWeekday[d] ?? 0))
  const totalFloor = floor.reduce((s, f) => s + f, 0)
  const openDays = days.filter((d) => floor[d] > 0)

  // Not enough weekly budget to cover every day's floor: scale the floors down
  // to fit the weekly total (coverage still surfaces understaffedBudget per
  // day). A genuinely under-budget week — the warning is now honest.
  if (totalFloor >= weeklyHourlyHours) {
    if (totalFloor <= 0) return days.map((weekday) => ({ weekday, hourlyHours: 0 }))
    return days.map((weekday) => ({
      weekday,
      hourlyHours: Math.floor(weeklyHourlyHours * (floor[weekday] / totalFloor) * 2) / 2,
    }))
  }

  // Reserve each day's floor, then distribute the remainder by sales weight
  // (even split across open days when weights are absent/zero). Closed days get
  // nothing — the remainder never lands on a day with no floor.
  const remainder = weeklyHourlyHours - totalFloor
  const pool = openDays.length > 0 ? openDays : days
  const poolBps = pool.reduce((s, d) => s + Math.max(0, weightsByWeekday?.[d] ?? 0), 0)
  const useWeights = !!weightsByWeekday && poolBps > 0

  return days.map((weekday) => {
    let extra = 0
    if (pool.includes(weekday)) {
      extra = useWeights
        ? remainder * (Math.max(0, weightsByWeekday![weekday] ?? 0) / poolBps)
        : remainder / pool.length
    }
    return { weekday, hourlyHours: Math.floor((floor[weekday] + extra) * 2) / 2 }
  })
}
