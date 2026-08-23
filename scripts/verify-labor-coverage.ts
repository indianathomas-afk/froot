/**
 * Labor Phase 3 acceptance fixture — daily split, adjustment, coverage.
 *
 *   npx tsx scripts/verify-labor-coverage.ts
 *
 * Pure functions, no DB. Coverage is demand-shaped + budget-capped, floored at
 * 1 while open, with the salaried GM counted on floor in their window.
 */
import {
  splitWeeklyHoursToDays,
  splitWeeklyHoursToDaysFloorFirst,
  capGmFloorCredits,
  applyDayAdjustment,
} from "../src/lib/labor-daily"
import { computeDailyCoverage, demandShapeSource, type HourNet } from "../src/lib/labor-coverage"

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

console.log("\n6 · GM 40h weekly cap (capGmFloorCredits):")
// 7 open days × a 6h GM window = 42h > 40 → scaled to exactly 40 total.
const capped = capGmFloorCredits([6, 6, 6, 6, 6, 6, 6])
check("weekly total capped at 40", Math.round(capped.reduce((s, h) => s + h, 0)), 40)
check("each day scaled proportionally (6 → 40/42)", +capped[0].toFixed(3), +((6 * 40) / 42).toFixed(3))
// Under the cap (5 open days × 6h = 30h) → unchanged.
const uncapped = capGmFloorCredits([6, 6, 6, 6, 6, 0, 0])
check("under 40h left unchanged", uncapped[0], 6)
check("closed day stays 0", uncapped[5], 0)

console.log("\n7 · Floor-first split (NEW DEFAULT) — floor guaranteed before sales weight:")
// Mon–Fri open, each needs a 6h floor; weekend closed. Weekly hourly = 40, so
// 30h of floor + a 10h remainder. All the sales weight sits on Friday.
const floors = [6, 6, 6, 6, 6, 0, 0]
const heavyFri = [0, 0, 0, 0, 10000, 0, 0]
const ff = splitWeeklyHoursToDaysFloorFirst({ weeklyHourlyHours: 40, weightsByWeekday: heavyFri, floorHoursByWeekday: floors })
check("Mon floor honored despite 0 sales weight", ff[0].hourlyHours, 6.0)
check("Fri gets floor + all remainder (6+10)", ff[4].hourlyHours, 16.0)
check("closed Sat stays 0", ff[5].hourlyHours, 0)
check("sum ≤ weekly total (40)", ff.reduce((s, d) => s + d.hourlyHours, 0) <= 40, true)
// The OLD sales-weighted split with the same weights starves Monday — the L-1
// floor-vs-budget conflict this phase fixes.
const sw = splitWeeklyHoursToDays({ weeklyHourlyHours: 40, weightsByWeekday: heavyFri, openDays: [0, 1, 2, 3, 4] })
check("(contrast) sales-weighted starves Mon → 0", sw[0].hourlyHours, 0)

console.log("\n8 · Floor-first under-budget — floors scale down, still ≤ weekly:")
// Floors total 30h but only 20h of weekly hourly budget → scaled to fit.
const tightFF = splitWeeklyHoursToDaysFloorFirst({ weeklyHourlyHours: 20, weightsByWeekday: null, floorHoursByWeekday: floors })
check("Mon scaled to 20×6/30 = 4.0", tightFF[0].hourlyHours, 4.0)
check("sum ≤ weekly total (20)", tightFF.reduce((s, d) => s + d.hourlyHours, 0) <= 20, true)

console.log("\n9 · Demand-shape source — same-day ruling (docs/DECISIONS.md 2026-08-19):")
// "Today" is INJECTED, never read from the clock: Wed 2026-08-19, store-local.
const today = "2026-08-19"
const lastFourWeds = "2026-08-12,2026-08-05,2026-07-29,2026-07-22"
// The current day takes the template, not its own partial-day cache.
const sameDay = demandShapeSource(today, today)
check("today uses no per-date cache", sameDay.actualsDate, null)
check("today averages the last 4 completed Wednesdays", sameDay.templateDates.join(","), lastFourWeds)
check("today is NOT in its own template window", sameDay.templateDates.includes(today), false)
// A past day still uses its own complete cache.
const pastDay = demandShapeSource("2026-08-18", today)
check("past day uses its own cache", pastDay.actualsDate, "2026-08-18")
// Deterministic: day-of draws the curve yesterday's future-day view drew.
const viewedYesterday = demandShapeSource(today, "2026-08-18")
check("same window as yesterday's future view of today", viewedYesterday.templateDates.join(","), lastFourWeds)
// Future days are unchanged in kind — template, same completed-weekday window.
const nextWed = demandShapeSource("2026-08-26", today)
check("future same-weekday day uses the template", nextWed.actualsDate, null)
check("future window excludes today too", nextWed.templateDates.join(","), lastFourWeds)
const nextMon = demandShapeSource("2026-08-24", today)
check("future Monday averages the last 4 completed Mondays", nextMon.templateDates.join(","), "2026-08-17,2026-08-10,2026-08-03,2026-07-27")

console.log("\n10 · R7-D — the GM must not satisfy the floor of one body:")
// Froot does not know WHICH hours the GM is at WHICH store: the only two stores
// in the estate that draw a band share one GM at 50% each. Counting her as a
// present body is wrong in the direction that leaves a store empty, so the
// floor of 1 and supervisorGap are both HOURLY questions. The band still draws
// (points[].gm is untouched) — it just stops paying for itself.
//
// (a) Zero-demand morning under a GM band. All the sales weight sits after 2p,
// so largest-remainder places ZERO hourly heads in 8a–2p — exactly the hours
// the GM band covers.
const morningDead: HourNet[] = Array.from({ length: 12 }, (_, i) => ({ hour: 8 + i, net: 8 + i >= 14 ? 1000 : 0 }))
const gmFloor = computeDailyCoverage({ hourlyBudgetHours: 12, demand: morningDead, open, gmWindow: { startHour: 8, endHour: 14 }, hasHourlySupervisor: true })!
check(
  "every open hour has ≥ 1 HOURLY head (GM does not satisfy the floor)",
  gmFloor.points.filter((p) => p.open).every((p) => p.hourly >= 1),
  true
)
check("9a is inside the band", gmFloor.points.find((p) => p.hour === 9)!.gm, true)
check("9a still has an hourly body", gmFloor.points.find((p) => p.hour === 9)!.hourly >= 1, true)
check("the band still DRAWS — points[].gm untouched", gmFloor.points.filter((p) => p.gm).length, 6)
check("floor-1 bumps inside the band push hourly over budget", gmFloor.understaffedBudget, true)

// (b) The GM band covers the WHOLE open window and there is no hourly
// supervisor. The gap is real — she is at the other store half the time — so it
// must be flagged, not suppressed by the band's width.
const gmAllDay = computeDailyCoverage({ hourlyBudgetHours: 40, demand, open, gmWindow: { startHour: 8, endHour: 20 }, hasHourlySupervisor: false })!
check("supervisorGap fires when the GM is the only supervisory cover", gmAllDay.supervisorGap, true)
// An hourly supervisor still clears it — the gate is about the GM, not the flag.
const gmAllDaySup = computeDailyCoverage({ hourlyBudgetHours: 40, demand, open, gmWindow: { startHour: 8, endHour: 20 }, hasHourlySupervisor: true })!
check("an hourly supervisor still clears the gap", gmAllDaySup.supervisorGap, false)

console.log(`\n${failures === 0 ? "✅ All checks passed." : `❌ ${failures} check(s) failed.`}`)
process.exitCode = failures === 0 ? 0 : 1
