/**
 * Labor Phase 3 acceptance fixture — daily split, adjustment, coverage.
 *
 *   npx tsx scripts/verify-labor-coverage.ts
 *
 * Pure functions, no DB. Coverage is demand-shaped + budget-capped, floored at
 * 1 while open, with the salaried GM counted on floor in their window.
 */
import { splitWeeklyHoursToDays, applyDayAdjustment } from "../src/lib/labor-daily"
import { computeDailyCoverage, type HourNet } from "../src/lib/labor-coverage"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

console.log("1 · Daily split (weeklyHourly 102.0, weights Mon–Sun 1000/1200/1300/1500/1800/2000/1200):")
const split = splitWeeklyHoursToDays({ weeklyHourlyHours: 102, weightsByWeekday: [1000, 1200, 1300, 1500, 1800, 2000, 1200], openDays: [0, 1, 2, 3, 4, 5, 6] })
check("Mon", split[0].hourlyHours, 10.0)
check("Fri", split[4].hourlyHours, 18.0)
check("Sat", split[5].hourlyHours, 20.0)
check("sum ≤ 102", split.reduce((s, d) => s + d.hourlyHours, 0) <= 102, true)

console.log("\n2 · Adjustment (Fri 18.0h at -20% → 14.0):")
check("adjusted", applyDayAdjustment(18, -20), 14.0)
check("clamps at 0", applyDayAdjustment(5, -100), 0)

// Store open 8a–8p (20:00 exclusive). Demand peaks at 3p (hour 15).
const open = { startHour: 8, endHour: 20 }
const demand: HourNet[] = Array.from({ length: 12 }, (_, i) => ({ hour: 8 + i, net: 8 + i === 15 ? 500 : 100 }))

console.log("\n3 · Demand-shaped, budget-capped (budget 40h, GM 8a–2p):")
const cov = computeDailyCoverage({ hourlyBudgetHours: 40, demand, open, gmWindow: { startHour: 8, endHour: 14 }, hasHourlySupervisor: true })!
check("peak follows demand (3p / hour 15)", cov.peakHours.includes(15), true)
check("every open hour ≥ 1 total", cov.points.filter((p) => p.open).every((p) => p.headcount >= 1), true)
check("GM counted on floor at 9a", cov.points.find((p) => p.hour === 9)!.gm, true)
check("GM NOT on floor at 5p", cov.points.find((p) => p.hour === 17)!.gm, false)
check("headcount = hourly + GM at 9a", cov.points.find((p) => p.hour === 9)!.headcount, cov.points.find((p) => p.hour === 9)!.hourly + 1)
check("within budget (not understaffed)", cov.understaffedBudget, false)
check("no supervisor gap (hourly sup exists)", cov.supervisorGap, false)

console.log("\n4 · Budget cap — tiny budget forces floor-1 over budget:")
const tight = computeDailyCoverage({ hourlyBudgetHours: 2, demand, open, gmWindow: null, hasHourlySupervisor: true })!
check("every open hour still ≥ 1", tight.points.filter((p) => p.open).every((p) => p.headcount >= 1), true)
check("understaffedBudget flagged", tight.understaffedBudget, true)

console.log("\n5 · Supervisor gap — open hours outside GM window, no hourly supervisor:")
const gap = computeDailyCoverage({ hourlyBudgetHours: 40, demand, open, gmWindow: { startHour: 8, endHour: 14 }, hasHourlySupervisor: false })!
check("supervisorGap flagged", gap.supervisorGap, true)

console.log(`\n${failures === 0 ? "✅ All checks passed." : `❌ ${failures} check(s) failed.`}`)
process.exitCode = failures === 0 ? 0 : 1
