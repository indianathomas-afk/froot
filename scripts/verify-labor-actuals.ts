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
 */
import {
  computeLaborActuals,
  computeHealth,
  type LaborActualsTimecard,
} from "../src/lib/labor-actuals"

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

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}\n`)
process.exit(failures === 0 ? 0 : 1)
