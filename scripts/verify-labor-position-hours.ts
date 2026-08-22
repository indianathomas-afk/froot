/**
 * R7 option B acceptance fixture — the per-store salaried resolution rule and
 * the promotion invariant.
 *
 *   npx tsx scripts/verify-labor-position-hours.ts
 *
 * PURE. No database, no network — the same shape as verify-labor-budget.ts.
 *
 * WHAT THIS PROVES: the ENGINE is invariant under an empty declaration table,
 * field for field, and moves in the named direction when a declaration exists.
 * WHAT IT DOES NOT PROVE: anything about the estate. The deployed stores' numbers
 * depend on live forecast and sales rows, and no fixture can reach those. That
 * proof is the BEFORE/AFTER capture (scripts/capture-labor-budget.ts).
 */
import {
  resolveSalariedHours,
  resolveGmCeilingHours,
  type StoreHoursDeclarations,
} from "../src/lib/labor-position-hours"
import { computeWeeklyLaborBudget, type LaborBudgetPosition, type LaborBudgetSettings } from "../src/lib/labor-budget"
import { capGmFloorCredits } from "../src/lib/labor-daily"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

const GM = { id: "pos_gm", impliedWeeklyHours: 40 }
const TEAM = { id: "pos_team", impliedWeeklyHours: null }
const empty: StoreHoursDeclarations = new Map()

// ── 1. The resolution rule ────────────────────────────────────────────────────
console.log("1 · resolveSalariedHours — absent means inherit, 0 is a declaration:")
check("absent -> org figure (THE INVARIANT CASE)", resolveSalariedHours(GM, empty), 40)
check("declared 0 -> 0, NOT the org figure", resolveSalariedHours(GM, new Map([["pos_gm", 0]])), 0)
check("declared 20 -> 20", resolveSalariedHours(GM, new Map([["pos_gm", 20]])), 20)
check("declared 45 -> 45 (above the org figure)", resolveSalariedHours(GM, new Map([["pos_gm", 45]])), 45)
check("hourly position, no declaration -> null", resolveSalariedHours(TEAM, empty), null)
check("another position's declaration is not visible", resolveSalariedHours(GM, new Map([["pos_team", 7]])), 40)
// A map is loaded per store (loadStoreHoursDeclarations is storeId-scoped), so a
// different store's row can never appear in it. Asserted as a contract.
check("a map built for another store cannot leak in", resolveSalariedHours(GM, new Map([["pos_gm_other_store", 0]])), 40)

// ── 2. THE PROMOTION INVARIANT — full result, field for field ─────────────────
// Not salariedHours alone. blendedHourlyRate and hourlyHours are the only fields
// that would catch a rate regression (D24), and they are the reason this compares
// everything rather than the obvious three.
console.log("\n2 · Empty declarations reproduce the locked acceptance case EXACTLY:")
const LEGEND: LaborBudgetPosition[] = [
  { payType: "SALARIED", defaultHourlyRate: 20, impliedWeeklyHours: 40, active: true },
  { payType: "SALARIED", defaultHourlyRate: 18, impliedWeeklyHours: 40, active: true },
  { payType: "HOURLY", defaultHourlyRate: 15, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 13, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 12, impliedWeeklyHours: null, active: true },
]
const SETTINGS: LaborBudgetSettings = { laborTargetPct: 20, roundingIncrement: 1000, plannedBlendedRate: 12.5 }
const acc = computeWeeklyLaborBudget({ settings: SETTINGS, positions: LEGEND, forecast: { total: 14900 } })!
check("conservative sales", acc.conservativeSales, 14000)
check("total labor budget", acc.totalLaborBudget, 2800)
check("salaried cost", acc.salariedCost, 1520)
check("salaried hours", acc.salariedHours, 80)
check("hourly dollars", acc.hourlyDollars, 1280)
check("blended hourly rate", acc.blendedHourlyRate, 12.5)
check("hourly hours", acc.hourlyHours, 102.0)
check("total schedulable hours", acc.totalSchedulableHours, 182.0)
check("projected labor % (1 dp)", Number(acc.projectedLaborPctAtForecast!.toFixed(1)), 18.8)
check("floorExceedsBudget", acc.floorExceedsBudget, false)

// ── 3. D24's canaries, against staging's real seeded legend ───────────────────
// Gary's ruling: by name, exact equality, no tolerance. These are the two facts
// the BEFORE capture pinned across all five budgeted staging stores.
console.log("\n3 · D24 canaries — the seeded legend, zero declarations:")
const SEEDED: { id: string; payType: "HOURLY" | "SALARIED"; rate: number; implied: number | null }[] = [
  { id: "pos_gm", payType: "SALARIED", rate: 20, implied: 40 },
  { id: "pos_asm", payType: "HOURLY", rate: 18, implied: null },
  { id: "pos_lead", payType: "HOURLY", rate: 15, implied: null },
  { id: "pos_sup", payType: "HOURLY", rate: 13, implied: null },
  { id: "pos_team", payType: "HOURLY", rate: 12, implied: null },
]
const SEEDED_SETTINGS: LaborBudgetSettings = { laborTargetPct: 20, roundingIncrement: 1000, plannedBlendedRate: null }
const resolveAll = (decls: StoreHoursDeclarations): LaborBudgetPosition[] =>
  SEEDED.map((p) => ({
    payType: p.payType,
    defaultHourlyRate: p.rate,
    impliedWeeklyHours: resolveSalariedHours({ id: p.id, impliedWeeklyHours: p.implied }, decls),
    active: true,
  }))

// The five budgeted staging stores' forecastTotal, from
// docs/prompts/r7_budget_BEFORE_staging_2026-08-22.jsonl.
const STAGING = [
  { name: "Carson", total: 14097.63 },
  { name: "Las Brisas", total: 18836.25 },
  { name: "Meadowood Mall", total: 14566.64 },
  { name: "South Reno", total: 16401.48 },
  { name: "UNR", total: 5566.49 },
]
for (const s of STAGING) {
  const r = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(empty), forecast: { total: s.total } })!
  check(`${s.name}: blendedHourlyRate == 14.5`, r.blendedHourlyRate, 14.5)
  check(`${s.name}: salariedCost == 800`, r.salariedCost, 800)
  check(`${s.name}: salariedHours == 40`, r.salariedHours, 40)
}

// ── 4. A declaration moves the numbers, in the named direction ────────────────
// R7 audit §2: declaring 0 is a REDISTRIBUTION, not a subtraction. salariedCost
// is the subtrahend that sizes the hourly pool, so removing it moves those
// dollars into hourly hours. UNR is the worked case.
console.log("\n4 · UNR declaring 0 — hourly hours go UP, budget unchanged:")
const unrInherit = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(empty), forecast: { total: 5566.49 } })!
const unrZero = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(new Map([["pos_gm", 0]])), forecast: { total: 5566.49 } })!
check("inherited: hourlyHours", unrInherit.hourlyHours, 13.5)
check("declared 0: salariedCost", unrZero.salariedCost, 0)
check("declared 0: salariedHours", unrZero.salariedHours, 0)
check("declared 0: hourlyHours RISES", unrZero.hourlyHours, 68.5)
check("declared 0: totalLaborBudget UNCHANGED", unrZero.totalLaborBudget, unrInherit.totalLaborBudget)
check("declared 0: blendedHourlyRate UNCHANGED", unrZero.blendedHourlyRate, unrInherit.blendedHourlyRate)

console.log("\n5 · UNR declaring 20 — half the cost, half the hours:")
const unr20 = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(new Map([["pos_gm", 20]])), forecast: { total: 5566.49 } })!
check("salariedCost is half", unr20.salariedCost, 400)
check("salariedHours is half", unr20.salariedHours, 20)
check("hourlyHours", unr20.hourlyHours, 41.0)
check("blendedHourlyRate UNCHANGED", unr20.blendedHourlyRate, 14.5)

// ── 6. The GM ceiling (S5-D19) ────────────────────────────────────────────────
console.log("\n6 · resolveGmCeilingHours — the substitution is a no-op at 40:")
check("resolved 40 -> ceiling 40 (today's estate)", resolveGmCeilingHours(40, 40), 40)
check("resolved 0 -> fallback (irrelevant; credits are 0 anyway)", resolveGmCeilingHours(0, 40), 40)
check("resolved 20 -> ceiling 20", resolveGmCeilingHours(20, 40), 20)
check("resolved 45 -> ceiling 45 (closes D10's cap mismatch)", resolveGmCeilingHours(45, 40), 45)

const gmRaw = [8, 8, 8, 8, 8, 8, 8] // 56 raw GM hours
const at40 = capGmFloorCredits(gmRaw, resolveGmCeilingHours(40, 40))
const at45 = capGmFloorCredits(gmRaw, resolveGmCeilingHours(45, 40))
check("ceiling 40 -> credits sum to 40", +at40.reduce((a, b) => a + b, 0).toFixed(6), 40)
check("ceiling 45 -> credits sum to 45, not 40", +at45.reduce((a, b) => a + b, 0).toFixed(6), 45)

// S5-D10's SECOND case — OPEN BY RULING (Gary, D19). Asserted so the gap is
// pinned rather than assumed closed: a short-hours store's credits stay BELOW its
// declaration, so Sigma gmCreditHours != salariedHours and the identity does not hold.
const short = [3, 3, 3, 3, 3, 0, 0] // 15 raw GM hours against a 40-hour declaration
const shortCredits = capGmFloorCredits(short, resolveGmCeilingHours(40, 40))
check("short-hours store: credits stay 15, NOT scaled up to 40 (D10 case 2 OPEN)", +shortCredits.reduce((a, b) => a + b, 0).toFixed(6), 15)

// ── 7. D28 — floorExceedsBudget at exact equality ─────────────────────────────
console.log("\n7 · D28 — the flag fires when salaried cost EQUALS the whole budget:")
// conservative 4000 x 20% = 800 total budget; seeded salaried cost is exactly 800.
const equality = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(empty), forecast: { total: 4000 } })!
check("totalLaborBudget", equality.totalLaborBudget, 800)
check("salariedCost", equality.salariedCost, 800)
check("hourlyHours is 0 — the flag's exact symptom", equality.hourlyHours, 0)
check("floorExceedsBudget is TRUE at equality (was false before D28)", equality.floorExceedsBudget, true)
const under = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(empty), forecast: { total: 5000 } })!
check("still false below equality (no over-fire)", under.floorExceedsBudget, false)
const over = computeWeeklyLaborBudget({ settings: SEEDED_SETTINGS, positions: resolveAll(empty), forecast: { total: 3000 } })!
check("still true above equality", over.floorExceedsBudget, true)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
