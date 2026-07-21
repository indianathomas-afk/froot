// Weekly labor budget — the core Phase-1 calculation. PURE (no DB) so it's
// unit-testable (scripts/verify-labor-budget.ts). Inputs are DOLLARS (the
// codebase convention); internally everything converts to integer cents so the
// tiered rounding and half-hour splits are exact and never drift by a float
// penny, then converts back to dollars on the way out. See LABOR.md.

export type LaborBudgetSettings = {
  laborTargetPct: number // percent, e.g. 20 (= 20%)
  roundingIncrement: number // dollars, e.g. 1000
  plannedBlendedRate: number | null // dollars; null = compute from hourly positions
}

export type LaborBudgetPosition = {
  payType: "HOURLY" | "SALARIED"
  defaultHourlyRate: number // dollars
  impliedWeeklyHours: number | null
  active: boolean
}

export type LaborBudgetForecast = {
  total: number // dollars — total projected sales (delivery already included; Phase 2)
}

export type LaborBudgetResult = {
  salesBasis: number // dollars — store (+ delivery if the denominator includes it)
  conservativeSales: number // dollars — salesBasis floored to the rounding tier
  totalLaborBudget: number // dollars — conservativeSales × target%
  salariedCost: number // dollars — Σ salaried weekly cost
  salariedHours: number // Σ salaried implied weekly hours
  hourlyDollars: number // dollars — budget left for hourly staff after salaried
  blendedHourlyRate: number // dollars — planned override or mean of hourly rates
  hourlyHours: number // hours (0.5 steps, rounded down)
  totalSchedulableHours: number // salariedHours + hourlyHours
  projectedLaborPctAtForecast: number | null // % of salesBasis; null if no sales
  floorExceedsBudget: boolean // salaried cost alone exceeds the whole budget
}

// dollars → integer cents (round absorbs float representation error).
const toCents = (dollars: number) => Math.round(dollars * 100)
// integer cents → dollars.
const toDollars = (cents: number) => cents / 100

// Returns null when there's no forecast — the caller renders the empty state.
export function computeWeeklyLaborBudget({
  settings,
  positions,
  forecast,
}: {
  settings: LaborBudgetSettings
  positions: LaborBudgetPosition[]
  forecast: LaborBudgetForecast | null
}): LaborBudgetResult | null {
  if (!forecast) return null

  const incCents = toCents(settings.roundingIncrement)

  // 1. sales basis — total projected sales (Phase 2: delivery is already in the
  //    total; the in-store/delivery split was dropped).
  const salesBasisCents = toCents(forecast.total)

  // 2. conservative sales — round DOWN to the nearest tier (no full-step-down;
  //    a basis already on a boundary stays there). Rule locked 2026-07-20.
  const conservativeSalesCents =
    incCents > 0 ? Math.floor(salesBasisCents / incCents) * incCents : salesBasisCents

  // 3. total labor budget
  const totalLaborBudgetCents = Math.round((conservativeSalesCents * settings.laborTargetPct) / 100)

  // 4. salaried floor
  const active = positions.filter((p) => p.active)
  let salariedCostCents = 0
  let salariedHours = 0
  for (const p of active) {
    if (p.payType === "SALARIED" && p.impliedWeeklyHours && p.impliedWeeklyHours > 0) {
      salariedCostCents += toCents(p.defaultHourlyRate) * p.impliedWeeklyHours
      salariedHours += p.impliedWeeklyHours
    }
  }

  // 5. dollars left for hourly staff
  const hourlyDollarsCents = Math.max(0, totalLaborBudgetCents - salariedCostCents)

  // 6. blended hourly rate — planned override, else mean of active hourly rates
  let blendedHourlyRateCents: number
  if (settings.plannedBlendedRate != null) {
    blendedHourlyRateCents = toCents(settings.plannedBlendedRate)
  } else {
    const hourlyRates = active.filter((p) => p.payType === "HOURLY").map((p) => toCents(p.defaultHourlyRate))
    blendedHourlyRateCents =
      hourlyRates.length > 0
        ? Math.round(hourlyRates.reduce((sum, r) => sum + r, 0) / hourlyRates.length)
        : 0
  }

  // 7. hourly hours — round DOWN to the nearest 0.5 hr (conservative)
  const hourlyHours =
    blendedHourlyRateCents > 0 ? Math.floor((hourlyDollarsCents / blendedHourlyRateCents) * 2) / 2 : 0

  // 8–9. totals + the projected % the manager sees (buffer below target)
  const totalSchedulableHours = salariedHours + hourlyHours
  const projectedLaborPctAtForecast =
    salesBasisCents > 0 ? (totalLaborBudgetCents / salesBasisCents) * 100 : null

  return {
    salesBasis: toDollars(salesBasisCents),
    conservativeSales: toDollars(conservativeSalesCents),
    totalLaborBudget: toDollars(totalLaborBudgetCents),
    salariedCost: toDollars(salariedCostCents),
    salariedHours,
    hourlyDollars: toDollars(hourlyDollarsCents),
    blendedHourlyRate: toDollars(blendedHourlyRateCents),
    hourlyHours,
    totalSchedulableHours,
    projectedLaborPctAtForecast,
    floorExceedsBudget: salariedCostCents > totalLaborBudgetCents,
  }
}
