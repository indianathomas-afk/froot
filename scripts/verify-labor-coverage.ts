/**
 * Labor Phase 2 acceptance fixture — daily split, adjustment, coverage.
 *
 *   npx tsx scripts/verify-labor-coverage.ts
 *
 * Pure functions, no DB. Asserts the locked cases from the Phase 2 prompt.
 */
import { splitWeeklyHoursToDays, applyDayAdjustment } from "../src/lib/labor-daily"
import { computeDailyCoverage, type DaypartRule, type HourNet } from "../src/lib/labor-coverage"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

console.log("1 · Daily split (weeklyHourly 102.0, weights Mon–Sun 1000/1200/1300/1500/1800/2000/1200):")
const split = splitWeeklyHoursToDays({
  weeklyHourlyHours: 102,
  weightsByWeekday: [1000, 1200, 1300, 1500, 1800, 2000, 1200],
  openDays: [0, 1, 2, 3, 4, 5, 6],
})
check("Mon", split[0].hourlyHours, 10.0)
check("Fri", split[4].hourlyHours, 18.0)
check("Sat", split[5].hourlyHours, 20.0)
const splitSum = split.reduce((s, d) => s + d.hourlyHours, 0)
check("sum ≤ 102", splitSum <= 102, true)
console.log(`    (sum = ${splitSum})`)

console.log("\n2 · Adjustment (Fri 18.0h at -20% → 14.0):")
check("adjusted", applyDayAdjustment(18, -20), 14.0)
check("0% is identity", applyDayAdjustment(18, 0), 18.0)
check("clamps at 0", applyDayAdjustment(5, -100), 0)

console.log("\n3 · Coverage invariants (12h open day, dayHours 8, min-1 dayparts):")
const hourly: HourNet[] = Array.from({ length: 12 }, (_, i) => ({ hour: 8 + i, net: 100 }))
const dayparts: DaypartRule[] = [
  { name: "Opening", startHour: 8, endHour: 11, minHeadcount: 1, requiresSupervisor: false },
  { name: "Midday", startHour: 11, endHour: 17, minHeadcount: 1, requiresSupervisor: true },
  { name: "Closing", startHour: 17, endHour: 20, minHeadcount: 1, requiresSupervisor: false },
]
const cov = computeDailyCoverage({ dayHours: 8, hourly, open: { startHour: 8, endHour: 20 }, dayparts, hasSupervisoryPosition: false })!
const openPts = cov.points.filter((p) => p.open)
check("every open hour ≥ 1", openPts.every((p) => p.headcount >= 1), true)
check("exceedsDayHours (floors > budget)", cov.exceedsDayHours, true)
check("supervisor shortfall (needs sup, none defined)", cov.supervisorShortfall, true)

const cov2 = computeDailyCoverage({ dayHours: 8, hourly, open: { startHour: 8, endHour: 20 }, dayparts, hasSupervisoryPosition: true })!
check("no shortfall when a supervisory position exists", cov2.supervisorShortfall, false)

console.log("\n4 · Min-headcount floor is enforced:")
const cov3 = computeDailyCoverage({
  dayHours: 8,
  hourly,
  open: { startHour: 8, endHour: 20 },
  dayparts: [{ name: "Peak", startHour: 11, endHour: 14, minHeadcount: 3, requiresSupervisor: false }],
  hasSupervisoryPosition: true,
})!
check("peak hours meet min 3", cov3.points.filter((p) => p.hour >= 11 && p.hour < 14).every((p) => p.headcount >= 3), true)

console.log(`\n${failures === 0 ? "✅ All checks passed." : `❌ ${failures} check(s) failed.`}`)
process.exitCode = failures === 0 ? 0 : 1
