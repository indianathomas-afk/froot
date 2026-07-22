/**
 * Labor Phase 1 acceptance fixture — computeWeeklyLaborBudget.
 *
 *   npx tsx scripts/verify-labor-budget.ts
 *
 * Pure function, no DB. Asserts:
 *   1. The locked acceptance case (store $14,900 → 182.0 hrs / 18.8%).
 *   2. The empty-forecast state (null forecast → null result).
 *   3. The floorExceedsBudget flag (salaried floor > whole budget → hourly 0).
 */
import {
  computeWeeklyLaborBudget,
  type LaborBudgetPosition,
  type LaborBudgetSettings,
} from "../src/lib/labor-budget"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

// Shared rate legend (the seeded defaults / brief acceptance seed).
const POSITIONS: LaborBudgetPosition[] = [
  { payType: "SALARIED", defaultHourlyRate: 20, impliedWeeklyHours: 40, active: true },
  { payType: "SALARIED", defaultHourlyRate: 18, impliedWeeklyHours: 40, active: true },
  { payType: "HOURLY", defaultHourlyRate: 15, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 13, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 12, impliedWeeklyHours: null, active: true },
]

const SETTINGS: LaborBudgetSettings = {
  laborTargetPct: 20,
  roundingIncrement: 1000,
  plannedBlendedRate: 12.5,
}

console.log("1 · Acceptance case (total sales $14,900):")
const r = computeWeeklyLaborBudget({
  settings: SETTINGS,
  positions: POSITIONS,
  forecast: { total: 14900 },
})!
check("conservative sales", r.conservativeSales, 14000)
check("total labor budget", r.totalLaborBudget, 2800)
check("salaried cost", r.salariedCost, 1520)
check("salaried hours", r.salariedHours, 80)
check("hourly dollars", r.hourlyDollars, 1280)
check("hourly hours", r.hourlyHours, 102.0)
check("total schedulable hours", r.totalSchedulableHours, 182.0)
check("projected labor % (1 dp)", Number(r.projectedLaborPctAtForecast!.toFixed(1)), 18.8)
check("floorExceedsBudget", r.floorExceedsBudget, false)

console.log("\n2 · Empty-forecast state (null forecast):")
const empty = computeWeeklyLaborBudget({ settings: SETTINGS, positions: POSITIONS, forecast: null })
check("returns null", empty, null)

console.log("\n3 · floorExceedsBudget (total $1,000 — salaried floor > budget):")
const tight = computeWeeklyLaborBudget({
  settings: SETTINGS,
  positions: POSITIONS,
  forecast: { total: 1000 },
})!
check("total labor budget", tight.totalLaborBudget, 200)
check("floorExceedsBudget", tight.floorExceedsBudget, true)
check("hourly dollars clamp to 0", tight.hourlyDollars, 0)
check("hourly hours clamp to 0", tight.hourlyHours, 0)
check("total = salaried hours only", tight.totalSchedulableHours, 80)

console.log("\n4 · Blended-rate fallback (no plannedBlendedRate → mean of hourly rates):")
const meanRate = computeWeeklyLaborBudget({
  settings: { ...SETTINGS, plannedBlendedRate: null },
  positions: POSITIONS,
  forecast: { total: 14900 },
})!
// mean of $15/$13/$12 = $13.333… → $13.33
check("blended rate = mean of hourly", meanRate.blendedHourlyRate, 13.33)

console.log(`\n${failures === 0 ? "✅ All checks passed." : `❌ ${failures} check(s) failed.`}`)
process.exitCode = failures === 0 ? 0 : 1
