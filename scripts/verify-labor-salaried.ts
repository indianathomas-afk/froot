/**
 * R7-C acceptance fixture — per-person salaried allocation.
 *
 *   npx tsx scripts/verify-labor-salaried.ts
 *
 * PURE. No database, no network — the shape of verify-labor-budget.ts.
 *
 * WHAT THIS PROVES: the ENGINE. The resolution rule, the four invariants, and
 * the promotion manifest's arithmetic.
 * WHAT IT DOES NOT PROVE: anything about the estate. Deployed numbers depend on
 * live forecast and sales rows no fixture can reach; that proof is the
 * BEFORE/PREDICTED/AFTER capture run against PRODUCTION.
 */
import {
  resolveStoreSalaried,
  validateAllocationSet,
  seedWeeklyCostFromAnnual,
  FULL_ALLOCATION_BPS,
  type SalariedAllocationRow,
} from "../src/lib/labor-salaried"
import { computeWeeklyLaborBudget, type LaborBudgetPosition, type LaborBudgetSettings } from "../src/lib/labor-budget"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

// Kristie Connolly: $52,000/yr = $1,000.00/wk, 40 hrs/wk, Las Brisas 50% / UNR 50%.
const KRISTIE = { personId: "p_kristie", displayName: "Kristie Connolly", weeklyCost: 1000, weeklyHours: 40 }
const full = new Map([["p_kristie", FULL_ALLOCATION_BPS]])
const row = (bps: number): SalariedAllocationRow => ({ ...KRISTIE, allocationBps: bps })

// ── 1. INVARIANT 4 — absent means zero ───────────────────────────────────────
console.log("1 · Absent means zero — a store with no allocated person:")
const none = resolveStoreSalaried([], new Map())
check("salariedCost", none.salariedCost, 0)
check("salariedHours", none.salariedHours, 0)
check("hasSalariedPerson", none.hasSalariedPerson, false)
check("hasIncompleteAllocation", none.hasIncompleteAllocation, false)

// ── 2. The 50/50 split ───────────────────────────────────────────────────────
console.log("\n2 · Kristie 50/50 — each store carries half of her:")
const half = resolveStoreSalaried([row(5000)], full)
check("salariedCost", half.salariedCost, 500)
check("salariedHours", half.salariedHours, 20)
check("hasSalariedPerson", half.hasSalariedPerson, true)
check("hasIncompleteAllocation", half.hasIncompleteAllocation, false)

// ── 3. INVARIANT 3 — hours are FRACTIONAL ────────────────────────────────────
// Gary's own third-store example. Rounding each share to an Int gives
// 13 + 13 + 13 = 39 and loses an hour; the exact figures sum to 40.
console.log("\n3 · Fractional hours — 33.33 / 33.33 / 33.34 of a 40-hour person:")
const thirds = [3333, 3333, 3334].map((b) => resolveStoreSalaried([row(b)], full))
check("store 1 hours (NOT 13)", thirds[0].salariedHours, 13.332)
check("store 2 hours", thirds[1].salariedHours, 13.332)
check("store 3 hours", thirds[2].salariedHours, 13.336)
check("hours sum to exactly 40", +thirds.reduce((t, r) => t + r.salariedHours, 0).toFixed(10), 40)
check("costs sum to exactly 1000", +thirds.reduce((t, r) => t + r.salariedCost, 0).toFixed(2), 1000)
const roundedSum = [3333, 3333, 3334].reduce((t, b) => t + Math.round(40 * b / 10000), 0)
check("...and rounding to Int would have lost one", roundedSum, 39)

// ── 4. INVARIANT 2 — read asserts, never normalises ──────────────────────────
console.log("\n4 · A 50/40 person — under-allocated, charged as stored, flagged:")
const partial = new Map([["p_kristie", 9000]])
const lb = resolveStoreSalaried([row(5000)], partial)
const unr = resolveStoreSalaried([row(4000)], partial)
check("store at 50%: cost is 500, NOT normalised to 555.56", lb.salariedCost, 500)
check("store at 40%: cost is 400, NOT normalised to 444.44", unr.salariedCost, 400)
check("store at 50%: hours are 20, NOT 22.22", lb.salariedHours, 20)
check("flag raised at the 50% store", lb.hasIncompleteAllocation, true)
check("flag raised at the 40% store too", unr.hasIncompleteAllocation, true)
check("the banner names the person", lb.incompletePeople[0]?.displayName, "Kristie Connolly")
check("the banner carries the real total", lb.incompletePeople[0]?.totalBps, 9000)
check("charged total is 900 of 1000 — the unsafe direction, made LOUD", lb.salariedCost + unr.salariedCost, 900)

// ── 5. INVARIANT 1 — the write validator ─────────────────────────────────────
console.log("\n5 · validateAllocationSet — the write-side 100% enforcement:")
check("50/50 accepted", validateAllocationSet([{ storeId: "a", allocationBps: 5000 }, { storeId: "b", allocationBps: 5000 }]), null)
check("33/33/34 accepted", validateAllocationSet([{ storeId: "a", allocationBps: 3333 }, { storeId: "b", allocationBps: 3333 }, { storeId: "c", allocationBps: 3334 }]), null)
check("empty set accepted (not allocated anywhere)", validateAllocationSet([]), null)
check("100% at one store accepted", validateAllocationSet([{ storeId: "a", allocationBps: 10000 }]), null)
const under = validateAllocationSet([{ storeId: "a", allocationBps: 5000 }, { storeId: "b", allocationBps: 4000 }])
check("50/40 REJECTED", under !== null, true)
check("...and the message states the real total", under, "Allocations must total exactly 100% — this set totals 90.00%")
const over = validateAllocationSet([{ storeId: "a", allocationBps: 6000 }, { storeId: "b", allocationBps: 5000 }])
check("60/50 REJECTED", over !== null, true)
check("duplicate store REJECTED", validateAllocationSet([{ storeId: "a", allocationBps: 5000 }, { storeId: "a", allocationBps: 5000 }]) !== null, true)
check("no float tolerance — 9999 bps REJECTED", validateAllocationSet([{ storeId: "a", allocationBps: 9999 }]) !== null, true)

// ── 6. Seed-and-own ──────────────────────────────────────────────────────────
console.log("\n6 · seedWeeklyCostFromAnnual — Square's annual to a Froot weekly:")
check("Kristie $52,000/yr", seedWeeklyCostFromAnnual(52000), 1000)
check("Kelton $36,000/yr", seedWeeklyCostFromAnnual(36000), 692.31)
check("Karson $51,000/yr", seedWeeklyCostFromAnnual(51000), 980.77)

// ── 7. THE PROMOTION MANIFEST — the engine end of it ─────────────────────────
console.log("\n7 · Promotion manifest, week 2026-08-10 (staging BEFORE -> PREDICTED):")
const HOURLY: LaborBudgetPosition[] = [
  { payType: "HOURLY", defaultHourlyRate: 18, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 15, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 13, impliedWeeklyHours: null, active: true },
  { payType: "HOURLY", defaultHourlyRate: 12, impliedWeeklyHours: null, active: true },
]
const S: LaborBudgetSettings = { laborTargetPct: 20, roundingIncrement: 1000, plannedBlendedRate: null }
/// The SAME assembly getWeeklyDayPlan performs: allocated people become ONE
/// synthetic salaried position, hourly archetypes pass through untouched.
function budgetFor(total: number, bps: number | null) {
  const r = bps == null ? null : resolveStoreSalaried([row(bps)], full)
  const salaried = r && r.salariedHours > 0
    ? [{ payType: "SALARIED" as const, defaultHourlyRate: r.salariedCost / r.salariedHours, impliedWeeklyHours: r.salariedHours, active: true, weeklyCost: r.salariedCost }]
    : []
  return computeWeeklyLaborBudget({ settings: S, positions: [...salaried, ...HOURLY], forecast: { total } })!
}
const MANIFEST: [string, number, number | null, number, number, number][] = [
  // name, forecastTotal, allocBps, expected salariedHours, salariedCost, hourlyHours
  ["Carson",         14097.63, null,   0, 0,   193.0],
  ["Las Brisas",     18836.25, 5000,  20, 500, 213.5],
  ["Meadowood Mall", 14566.64, null,   0, 0,   193.0],
  ["South Reno",     16401.48, null,   0, 0,   220.5],
  ["UNR",             5566.49, 5000,  20, 500,  34.0],
]
for (const [name, total, bps, hrs, cost, hourly] of MANIFEST) {
  const b = budgetFor(total, bps)
  check(`${name}: salariedHours`, b.salariedHours, hrs)
  check(`${name}: salariedCost`, b.salariedCost, cost)
  check(`${name}: hourlyHours`, b.hourlyHours, hourly)
  // THE CANARY. If a person's cost ever reaches the rate mean, this moves first
  // and moves at every store at once.
  check(`${name}: blendedHourlyRate == 14.5 (CANARY)`, b.blendedHourlyRate, 14.5)
}

// ── 8. The synthetic position reproduces cost EXACTLY ────────────────────────
console.log("\n8 · rate x hours reproduces the resolved cost exactly, at odd splits:")
for (const bps of [3333, 1, 9999, 7777]) {
  const r = resolveStoreSalaried([row(bps)], new Map([["p_kristie", bps]]))
  const b = computeWeeklyLaborBudget({
    settings: S,
    positions: [{ payType: "SALARIED", defaultHourlyRate: r.salariedCost / r.salariedHours, impliedWeeklyHours: r.salariedHours, active: true, weeklyCost: r.salariedCost }, ...HOURLY],
    forecast: { total: 20000 },
  })!
  check(`${(bps / 100).toFixed(2)}%: engine cost == resolved cost`, b.salariedCost, r.salariedCost)
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
