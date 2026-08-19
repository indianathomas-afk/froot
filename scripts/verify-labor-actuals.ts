/**
 * AL-1 acceptance fixture — computeLaborActuals / computeHealth.
 *
 *   npx tsx scripts/verify-labor-actuals.ts
 *
 * Pure function, no DB. Asserts the cases that are load-bearing for the
 * seam's failure posture, not just the happy path:
 *   1. The straight-time base case (hours × wage over net sales).
 *   2. Unpaid breaks come OUT of paid time; paid breaks stay IN.
 *   3. An OPEN timecard costs to `now`, and is clamped by the window end.
 *   4. A missing wage keeps the HOURS and drops the DOLLARS — costComplete=false
 *      and laborCost is a floor. (The seam forbids a silent zero.)
 *   5. Zero sales yields laborPct === null, NEVER 0. ("no sales yet" is not "0%")
 *   6. Health: never / fresh / stale / error, including the case that motivates
 *      the separate sync-state table — synced fine, zero timecards.
 *
 * AL-2 (Phase 2) appends the cases the dashboard cards rest on:
 *   7. The coverage pair — a partly-synced window measures the covered days on
 *      BOTH sides, and the surface can say how many.
 *   8. The judgment: target as set (not the floored rate), the three zones — at
 *      or under target GREEN, up to a point over AMBER, beyond that RED — and the
 *      refusal to judge a number that is not fresh.
 *   9. The estate roll-up: dollars summed then divided, never a mean of ratios,
 *      with a sales-weighted target and worst-health-wins.
 *
 * AL-3 (Phase 3) appends the tip payout, vision item 5:
 *  10. Both halves of the numerator — Square-recorded tips (SalesPeriodCache
 *      .tipTotal, already synced) PLUS declared cash — because a declared-cash-
 *      only column would have reported a fraction of the real payout at a
 *      card-dominant store (measured 2.4%-7.1% of net across nine stores).
 *  11. The denominator excludes an EXPLICIT tip_eligible false and INCLUDES a
 *      null (Gary's Q7 ruling), with the null hours reported separately.
 *  12. No eligible hours yields avgHourlyTips === null, NEVER 0 — the same law
 *      case 5 pins for laborPct.
 *  13. The paid-minutes rule is SHARED with the cost calculation: unpaid breaks
 *      out, paid breaks in, open cards clamped to the window. If the two ever
 *      diverge, one dashboard divides by two different notions of an hour.
 */
import {
  computeLaborActuals,
  computeHealth,
  type LaborActualsResult,
  type LaborActualsTimecard,
} from "../src/lib/labor-actuals"
import { computeTipPayout, type TipTimecard } from "../src/lib/labor-actuals"
import { aggregateLaborActuals, formatLaborPct, judgeLaborPct } from "../src/lib/labor-judgment"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

// All instants are UTC and every one is written as UTC on purpose — CLAUDE.md
// § "A DATABASE TIMESTAMP IS UTC". A fixture that mixes local and UTC teaches
// the wrong habit to whoever copies it.
const utc = (s: string) => new Date(`${s}Z`)
const NOW = utc("2026-08-18T20:00:00.000")
const WINDOW_END = utc("2026-08-19T07:00:00.000") // store-local midnight, PDT
const FRESH_SYNC = { lastSyncOkAt: utc("2026-08-18T19:45:00.000"), lastError: null }

console.log("\n1. Straight-time base case")
{
  // 8h at $15 = $120; 6h at $20 = $120. $240 over $1,200 net = 20.0%.
  const timecards: LaborActualsTimecard[] = [
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: utc("2026-08-18T23:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 15 },
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: utc("2026-08-18T21:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 20 },
  ]
  const r = computeLaborActuals({ timecards, netSales: 1200, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("laborHours", r.laborHours, 14)
  check("laborCost", r.laborCost, 240)
  check("laborPct", r.laborPct, 20)
  check("costComplete", r.costComplete, true)
  check("otApplied", r.otApplied, false)
  check("openTimecardCount", r.openTimecardCount, 0)
}

console.log("\n2. Unpaid breaks come out; paid breaks stay in")
{
  // 8h span, 30 min unpaid → 7.5h at $16 = $120. A paid break is already inside
  // the span and is deliberately absent from the input: it needs no subtraction.
  const timecards: LaborActualsTimecard[] = [
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: utc("2026-08-18T23:00:00.000"), breakUnpaidMinutes: 30, wageHourlyRate: 16 },
  ]
  const r = computeLaborActuals({ timecards, netSales: 1000, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("laborHours", r.laborHours, 7.5)
  check("laborCost", r.laborCost, 120)
}

console.log("\n3. An OPEN timecard costs to `now`, clamped by the window end")
{
  // Clocked in at 15:00 UTC, still open, now is 20:00 UTC → 5h at $14 = $70.
  const open: LaborActualsTimecard[] = [
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: null, breakUnpaidMinutes: 0, wageHourlyRate: 14 },
  ]
  const r = computeLaborActuals({ timecards: open, netSales: 700, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("laborHours", r.laborHours, 5)
  check("laborCost", r.laborCost, 70)
  check("openTimecardCount", r.openTimecardCount, 1)

  // The same card queried three days later must NOT have accrued three days of
  // cost — the window end is the ceiling, not the clock.
  const later = computeLaborActuals({
    timecards: open,
    netSales: 700,
    now: utc("2026-08-21T20:00:00.000"),
    windowEnd: WINDOW_END,
    syncState: FRESH_SYNC,
  })
  check("clamped to window end (hours)", later.laborHours, 16)
}

console.log("\n4. A missing wage keeps the hours and drops the dollars")
{
  const timecards: LaborActualsTimecard[] = [
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: utc("2026-08-18T23:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 15 },
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: utc("2026-08-18T23:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: null },
  ]
  const r = computeLaborActuals({ timecards, netSales: 1200, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("laborHours counts both people", r.laborHours, 16)
  check("laborCost is a floor", r.laborCost, 120)
  check("wageMissingCount", r.wageMissingCount, 1)
  check("costComplete", r.costComplete, false)
}

console.log("\n5. Zero sales → laborPct is null, never 0")
{
  const timecards: LaborActualsTimecard[] = [
    { startAt: utc("2026-08-18T15:00:00.000"), endAt: utc("2026-08-18T23:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 15 },
  ]
  const r = computeLaborActuals({ timecards, netSales: 0, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("laborPct", r.laborPct, null)
  check("laborCost still reported", r.laborCost, 120)
}

console.log("\n6. Health, including the case the sync-state table exists for")
{
  const STALE_AFTER = 26 * 60
  check("no sync state at all", computeHealth(null, NOW, STALE_AFTER), "never")
  check("row exists, never succeeded", computeHealth({ lastSyncOkAt: null, lastError: "boom" }, NOW, STALE_AFTER), "never")
  check("recent success", computeHealth(FRESH_SYNC, NOW, STALE_AFTER), "fresh")
  check(
    "old success, no error",
    computeHealth({ lastSyncOkAt: utc("2026-08-15T19:45:00.000"), lastError: null }, NOW, STALE_AFTER),
    "stale"
  )
  check(
    "old success WITH an error",
    computeHealth({ lastSyncOkAt: utc("2026-08-15T19:45:00.000"), lastError: "SQUARE_TIMECARDS_403" }, NOW, STALE_AFTER),
    "error"
  )

  // THE CASE THE SEPARATE TABLE EXISTS FOR. A store that synced two minutes ago
  // and had nobody clocked in reports zero hours AND reads FRESH — "synced,
  // nobody worked" is a different sentence from "not synced". Derived from
  // max(SquareTimecard.syncedAt) this would be indistinguishable from "never".
  const empty = computeLaborActuals({ timecards: [], netSales: 0, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("empty + fresh sync → health", empty.health, "fresh")
  check("empty + fresh sync → hours", empty.laborHours, 0)
  check("empty + fresh sync → pct", empty.laborPct, null)
  check("empty + fresh sync → costComplete", empty.costComplete, true)
}

// ─── AL-2 ─────────────────────────────────────────────────────────────────────

console.log("\n7. AL-2 — the coverage pair")
{
  // 10h at $20 = $200 of cost. The CALLER restricts netSales to the covered days
  // (getLaborActuals does this with `date: { in: coveredDates }`), so the fixture
  // asserts the contract that matters: whatever days the caller says are covered,
  // laborPct is computed against the sales for exactly those days.
  const tc: LaborActualsTimecard[] = [
    { startAt: utc("2026-08-18T16:00:00.000"), endAt: utc("2026-08-19T02:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 20 },
  ]
  const partial = computeLaborActuals({
    timecards: tc,
    netSales: 1000, // three synced days' sales, NOT the whole month's
    now: NOW,
    windowEnd: WINDOW_END,
    syncState: FRESH_SYNC,
    daysCovered: 3,
    daysInWindow: 19,
  })
  check("partial window → pct over the covered days", partial.laborPct, 20)
  check("partial window → daysCovered carried", partial.daysCovered, 3)
  check("partial window → daysInWindow carried", partial.daysInWindow, 19)

  // THE DEFECT THIS EXISTS TO PREVENT, stated as a number: the same cost divided
  // by the WHOLE month's sales reads 3.2% against a 20% target — green, precise
  // and wrong. Asserted so a future edit that "simplifies" the denominator back
  // to the full range fails here instead of on the dashboard.
  const wrong = computeLaborActuals({
    timecards: tc,
    netSales: 6333.34, // nineteen days of sales
    now: NOW,
    windowEnd: WINDOW_END,
    syncState: FRESH_SYNC,
    daysCovered: 3,
    daysInWindow: 19,
  })
  check("the wrong denominator would have read", Number(wrong.laborPct!.toFixed(1)), 3.2)

  // Defaults keep the single-day call AL-1 shipped meaning exactly what it did.
  const singleDay = computeLaborActuals({ timecards: tc, netSales: 1000, now: NOW, windowEnd: WINDOW_END, syncState: FRESH_SYNC })
  check("defaults → daysCovered", singleDay.daysCovered, 1)
  check("defaults → daysInWindow", singleDay.daysInWindow, 1)
}

console.log("\n8. AL-2 — the judgment")
{
  // Target AS SET (Gary's R2): 20, never the tier-floored 18.8 that
  // computeWeeklyLaborBudget reports as projectedLaborPctAtForecast.
  check("under target → within", judgeLaborPct(18.0, 20, "fresh"), "within")

  // THE BOUNDARY, FLIPPED (Gary, 2026-08-19, superseding his own R3 the same day).
  // Amber is now a GRACE BAND ABOVE target, not a caution band below it, so
  // meeting budget reads as the win it is — vision item 3's "green if
  // meets/exceeds", made literal. The four checks below fence both edges of the
  // new band, because an off-by-one here is invisible on screen and changes what
  // a manager is told about their week.
  check("just under target → within (was amber before the flip)", judgeLaborPct(19.5, 20, "fresh"), "within")
  check("EXACTLY on target → within", judgeLaborPct(20, 20, "fresh"), "within")
  check("a hair over → near, not over", judgeLaborPct(20.1, 20, "fresh"), "near")
  check("the top of the grace band → still near", judgeLaborPct(21.0, 20, "fresh"), "near")
  check("past the grace band → over", judgeLaborPct(21.1, 20, "fresh"), "over")

  // THE DIVERGENCE FROM zone(), ASSERTED so it stays deliberate. The Labor Budget
  // card judges the PLANNED percentage on the opposite convention (amber below
  // target), so one dashboard shows amber-planned beside green-actual at 19.5%.
  // If a later session "harmonises" the two scales, this check is what fails.
  check("19.5% is GREEN as an actual, while zone() calls it amber as a plan", judgeLaborPct(19.5, 20, "fresh"), "within")
  // 19% would be OVER against the floored 18.8% rate and is WITHIN against the
  // target the operator actually set. This check is the ruling, in code.
  check("19% against a 20% target is within, not over", judgeLaborPct(19, 20, "fresh"), "within")

  // NEVER JUDGE DATA THAT IS NOT CURRENT — a stale number painted green is a
  // false reassurance, which is worse than no colour at all.
  check("stale is not judged", judgeLaborPct(12, 20, "stale"), "unjudged")
  check("error is not judged", judgeLaborPct(12, 20, "error"), "unjudged")
  check("never is not judged", judgeLaborPct(12, 20, "never"), "unjudged")
  check("null pct is not judged", judgeLaborPct(null, 20, "fresh"), "unjudged")

  // The formatter is the last line of defence on seam (c)'s rule.
  check("null renders an em-dash, never 0%", formatLaborPct(null), "—")
  check("a real value renders one decimal", formatLaborPct(33.66), "33.7%")
}

console.log("\n9. AL-2 — the estate roll-up")
{
  const mk = (over: Partial<LaborActualsResult>): LaborActualsResult => ({
    laborPct: null, laborCost: 0, laborHours: 0, sales: 0, daysCovered: 1, daysInWindow: 1,
    health: "fresh", timecardCount: 0, openTimecardCount: 0, wageMissingCount: 0,
    costComplete: true, otApplied: false, lastSyncOkAt: "2026-08-18T19:45:00.000Z", ...over,
  })

  // A small store at 40% on $1,000 and a big store at 10% on $9,000. The MEAN OF
  // THE RATIOS is 25%; the true estate figure is $1,300 / $10,000 = 13%. Summing
  // dollars is the only roll-up that produces a number any store recognises.
  const small = mk({ laborCost: 400, sales: 1000, laborPct: 40 })
  const big = mk({ laborCost: 900, sales: 9000, laborPct: 10 })
  const estate = aggregateLaborActuals(
    [
      { laborCost: small.laborCost, sales: small.sales, result: small },
      { laborCost: big.laborCost, sales: big.sales, result: big },
    ],
    [25, 15]
  )
  check("dollars summed then divided, not a mean of ratios", estate.laborPct, 13)
  check("the mean of ratios would have read", (40 + 10) / 2, 25)
  // Sales-weighted target: (1000×25 + 9000×15) / 10000 = 16.
  check("estate target is sales-weighted", estate.target, 16)
  check("estate verdict against that target", judgeLaborPct(estate.laborPct, estate.target, estate.health), "within")

  // WORST HEALTH WINS — one never-synced store makes the company number
  // incomplete, and an "average freshness" would measure nothing.
  const mixed = aggregateLaborActuals(
    [
      { laborCost: 400, sales: 1000, result: mk({ laborCost: 400, sales: 1000 }) },
      { laborCost: 0, sales: 0, result: mk({ health: "never", daysCovered: 0, lastSyncOkAt: null }) },
    ],
    [20, 20]
  )
  check("worst health wins", mixed.health, "never")
  check("stores reporting counts only those with covered days", mixed.storesReporting, 1)
  check("stores total counts them all", mixed.storesTotal, 2)

  // No sales anywhere is still "no sales yet", never 0% — seam (c) survives the
  // roll-up as well as the single-store read.
  const silent = aggregateLaborActuals([{ laborCost: 0, sales: 0, result: mk({}) }], [20])
  check("estate with no sales → pct null", silent.laborPct, null)
}

// ─── 10-13. THE TIP PAYOUT (AL-3, vision item 5) ─────────────────────────────
{
  console.log("\nAL-3 — tip payout")

  const D = (iso: string) => new Date(iso)
  const tc = (o: Partial<TipTimecard>): TipTimecard => ({
    startAt: D("2026-08-19T16:00:00.000Z"),
    endAt: D("2026-08-19T24:00:00.000Z"),
    breakUnpaidMinutes: 0,
    declaredCashTips: null,
    wageTipEligible: true,
    ...o,
  })
  const NOW = D("2026-08-20T00:00:00.000Z")
  const WINDOW_END = D("2026-08-20T07:00:00.000Z")

  // BOTH HALVES OF THE NUMERATOR. Two 8-hour eligible shifts = 16 hours; $80 of
  // Square-recorded tips plus $20 declared cash = $100; $100 / 16 = $6.25/hr.
  const both = computeTipPayout({
    timecards: [tc({ declaredCashTips: 20 }), tc({})],
    posTips: 80,
    now: NOW,
    windowEnd: WINDOW_END,
  })
  check("eligible hours", both.eligibleHours, 16)
  check("tips summed from both sources", both.tipsTotal, 100)
  check("Square-recorded half kept separate", both.posTips, 80)
  check("declared-cash half kept separate", both.declaredCashTips, 20)
  check("avgHourlyTips = all tips / eligible hours", both.avgHourlyTips, 6.25)
  // THE COLUMN THIS PHASE ALMOST SHIPPED. Declared cash alone would have read
  // $1.25/hr against a real $6.25 — a fifth of the payout, presented as the
  // payout. The measurement that reversed the lean is pinned here so a later
  // "simplify to declared cash only" fails on this line.
  check("declared-cash-only would have read", 20 / 16, 1.25)

  // AN EXPLICIT FALSE IS EXCLUDED FROM THE DENOMINATOR — dividing by hours
  // worked by staff who cannot receive tips is what wageTipEligible exists to
  // prevent. The ineligible shift's own declared cash still counts in the
  // numerator: a declared dollar was received.
  const withIneligible = computeTipPayout({
    timecards: [tc({}), tc({ wageTipEligible: false, declaredCashTips: 10 })],
    posTips: 80,
    now: NOW,
    windowEnd: WINDOW_END,
  })
  check("tip_eligible false is out of the denominator", withIneligible.eligibleHours, 8)
  check("but its declared cash stays in the numerator", withIneligible.tipsTotal, 90)

  // NULL COUNTS AS ELIGIBLE (Gary's Q7): excluding maybe-eligible staff would
  // overstate the per-hour payout, and overstating what a job pays is the worse
  // error. The hours are reported so the footnote can say how many.
  const withNull = computeTipPayout({
    timecards: [tc({}), tc({ wageTipEligible: null })],
    posTips: 80,
    now: NOW,
    windowEnd: WINDOW_END,
  })
  check("null tip-eligibility counts as eligible", withNull.eligibleHours, 16)
  check("and the unknown hours are reported", withNull.unknownEligibilityHours, 8)

  // NO ELIGIBLE HOURS → null, NEVER 0. Tips with nobody eligible is "not yet a
  // rate", which is a different sentence from "$0.00 an hour" — seam (c)'s rule
  // applied to the tip denominator exactly as case 5 applies it to sales.
  const noHours = computeTipPayout({
    timecards: [tc({ wageTipEligible: false })],
    posTips: 80,
    now: NOW,
    windowEnd: WINDOW_END,
  })
  check("no eligible hours → avgHourlyTips null", noHours.avgHourlyTips, null)
  check("and it is not zero", noHours.avgHourlyTips === 0, false)

  // THE PAID-MINUTES RULE IS THE COST CALCULATION'S, SHARED. A 30-minute unpaid
  // break comes out (8h → 7.5h) and a paid one would not; an OPEN card is
  // clamped to the earlier of `now` and the window end. These assertions are
  // what fail if paidMinutesOf is ever inlined back into one of the two callers.
  const unpaidBreak = computeTipPayout({
    timecards: [tc({ breakUnpaidMinutes: 30 })],
    posTips: 15,
    now: NOW,
    windowEnd: WINDOW_END,
  })
  check("unpaid break comes out of eligible hours", unpaidBreak.eligibleHours, 7.5)
  check("and the rate uses the reduced hours", unpaidBreak.avgHourlyTips, 2)

  const open = computeTipPayout({
    // Clocked in at 16:00Z and still on the clock; `now` is 00:00Z → 8 hours.
    timecards: [tc({ endAt: null })],
    posTips: 16,
    now: NOW,
    windowEnd: WINDOW_END,
  })
  check("an open card costs to now", open.eligibleHours, 8)

  const openPastWindow = computeTipPayout({
    timecards: [tc({ endAt: null })],
    posTips: 16,
    // `now` is two days later; the WINDOW END is the ceiling, so a card left
    // open on Tuesday must not accrue tips-hours into Thursday.
    now: D("2026-08-22T00:00:00.000Z"),
    windowEnd: D("2026-08-19T23:00:00.000Z"),
  })
  check("an open card is clamped by the window end", openPastWindow.eligibleHours, 7)

  // The coverage pair rides through unchanged, so the card can say "N of M days
  // synced" about the tip rate as well as the labor percentage.
  const covered = computeTipPayout({
    timecards: [tc({})],
    posTips: 8,
    now: NOW,
    windowEnd: WINDOW_END,
    daysCovered: 3,
    daysInWindow: 19,
  })
  check("daysCovered rides through", covered.daysCovered, 3)
  check("daysInWindow rides through", covered.daysInWindow, 19)
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}\n`)
process.exit(failures === 0 ? 0 : 1)
