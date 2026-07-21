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
