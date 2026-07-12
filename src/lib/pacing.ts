// ─── Pacing math (Phase F-4) ─────────────────────────────────────────────────
// Pure, client-safe helpers shared by the Dashboard Monthly Goal card, the
// single-store summary route, and the all-locations rollup — one home for the
// projection formula so the paths can't drift. No prisma imports here: this
// file is imported by client components.

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function monthStart(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

export function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export type ProjectionInput = {
  mtdActual: number
  mtdGoal: number | null // plan-derived MTD goal sum; null when no plan
  monthGoal: number | null
  daysElapsed: number
  daysInMonth: number
}

// Goal-weighted pacing when a Forecasting plan provides an MTD goal (it
// respects the weekday mix of the remaining days — 3 Saturdays left ≠ 1);
// run-rate otherwise: projected = MTD actual ÷ MTD goal × month goal.
// This is THE month-end projection formula — do not fork it.
export function projectMonthEnd({ mtdActual, mtdGoal, monthGoal, daysElapsed, daysInMonth }: ProjectionInput): number {
  if (mtdGoal !== null && mtdGoal > 0 && monthGoal !== null) return (mtdActual / mtdGoal) * monthGoal
  return daysElapsed > 0 ? (mtdActual / daysElapsed) * daysInMonth : 0
}

// ─── All-locations rollup ─────────────────────────────────────────────────────

export type RollupStoreInput = {
  todayNet: number
  mtdActual: number
  mtdGoal: number | null // plan MTD sum (DailyGoal rows through today)
  monthGoal: number | null // plan month total, or the manual StoreMonthlyGoal
  goalSource: "plan" | "manual" | null
  daysElapsed: number
  daysInMonth: number
}

export type RollupTotals = {
  todayNet: number
  mtdActual: number
  mtdGoal: number | null
  monthGoal: number | null
  projected: number | null
  pctToGoal: number | null
}

// A manual goal has no daily distribution, so its MTD share is prorated
// linearly. Feeding that through the goal-weighted formula reduces to exactly
// the run-rate projection the Monthly Goal card uses for manual goals — so
// per-store and rollup numbers stay consistent.
export function effectiveMtdGoal(s: RollupStoreInput): number | null {
  if (s.mtdGoal !== null) return s.mtdGoal
  if (s.monthGoal !== null && s.daysInMonth > 0) return round2(s.monthGoal * (s.daysElapsed / s.daysInMonth))
  return null
}

// Company-wide totals: sums across stores, with the same goal-weighted
// projection applied to the summed goals (DailyGoal rows are summed per store
// upstream — never averaged). Stores with no goal at all still contribute
// their sales to the totals and a run-rate projection.
export function computeRollup(stores: RollupStoreInput[]): RollupTotals {
  const todayNet = stores.reduce((s, r) => s + r.todayNet, 0)
  const mtdActual = stores.reduce((s, r) => s + r.mtdActual, 0)

  const withGoal = stores.filter((r) => r.monthGoal !== null && (effectiveMtdGoal(r) ?? 0) > 0)
  const withoutGoal = stores.filter((r) => !withGoal.includes(r))

  const mtdGoalSum = withGoal.reduce((s, r) => s + (effectiveMtdGoal(r) ?? 0), 0)
  const monthGoalSum = withGoal.reduce((s, r) => s + (r.monthGoal ?? 0), 0)

  const goalPart =
    withGoal.length > 0
      ? projectMonthEnd({
          mtdActual: withGoal.reduce((s, r) => s + r.mtdActual, 0),
          mtdGoal: mtdGoalSum,
          monthGoal: monthGoalSum,
          daysElapsed: withGoal[0].daysElapsed,
          daysInMonth: withGoal[0].daysInMonth,
        })
      : 0
  const runRatePart = withoutGoal.reduce(
    (s, r) => s + projectMonthEnd({ mtdActual: r.mtdActual, mtdGoal: null, monthGoal: null, daysElapsed: r.daysElapsed, daysInMonth: r.daysInMonth }),
    0
  )

  const hasAnyGoal = withGoal.length > 0
  const projected = stores.length > 0 ? round2(goalPart + runRatePart) : null
  return {
    todayNet: round2(todayNet),
    mtdActual: round2(mtdActual),
    mtdGoal: hasAnyGoal ? round2(mtdGoalSum) : null,
    monthGoal: hasAnyGoal ? round2(monthGoalSum) : null,
    projected,
    pctToGoal: hasAnyGoal && monthGoalSum > 0 && projected !== null ? (projected / monthGoalSum) * 100 : null,
  }
}
