/**
 * TAB-5 — the tablet home's refresh controller rules, pinned.
 *
 *   npx tsx scripts/verify-tab5-refresh.ts
 *
 * PURE, in the verify-tab1-today.ts style: no database, no browser, fixed
 * instants. (src/lib/reports.ts is imported only for localDateStr, a pure
 * function; nothing here opens a connection.)
 *
 * WHAT THIS CAN DETECT:
 *   - A CYCLE THAT RUNS WHEN IT MUST NOT: while hidden (ruling 1), while a
 *     sheet is open or a write is in flight (ruling 3), or while the previous
 *     cycle is still running (never two at once). Cases 1-5.
 *   - A router.refresh() WHILE OFFLINE (the offline guard, Gary 2026-11-10):
 *     a failed refresh is a full browser navigation, which leaves Safari's
 *     error page on an unattended tablet. Offline skips the cycle and the
 *     single refresh; back online runs again. Cases 5d-5g.
 *   - A ROLLOVER THAT FIRES ON THE WRONG CLOCK: on UTC's midnight instead of
 *     the store's (5:30 PM Pacific is already tomorrow in UTC), on the
 *     browser's zone, a fixed UTC offset that breaks across a daylight-saving
 *     change, or backwards when the device clock is behind the server.
 *     Cases 6-12.
 *   - THE CLIENT'S "TODAY" DRIFTING FROM THE SERVER'S: storeLocalDay() must
 *     agree with localDateStr() in src/lib/reports.ts — the function behind
 *     businessDayWindow(), the today's-checklist list and loadTabletData() —
 *     on every instant used here. Case 13.
 *   - THE PAGE MOVING TO A NEW DAY UNDER AN OPEN SHEET (ruling 3), or moving
 *     to a day the server has not rendered. Case 14.
 *   - A LOCAL TICK THAT MASKS A CHANGE MADE ON ANOTHER DEVICE forever, or one
 *     retired too early so it flickers off after a refresh raced the tap
 *     (ruling 4). Case 15.
 *
 * WHAT IT CANNOT DETECT: the React wiring (that every sheet and write actually
 * reports itself busy, that router.refresh keeps scroll and typed text). The
 * local check on a mocked page and Gary's staging list cover those.
 */
import {
  dayRolledOver,
  isBusy,
  mayRefreshServer,
  nextShownDay,
  pruneOverrides,
  shouldRunCycle,
  storeLocalDay,
  TABLET_REFRESH_MS,
  type TickOverride,
} from "../src/lib/tablet-refresh"
import { localDateStr } from "../src/lib/reports"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

const LA = "America/Los_Angeles"
const NY = "America/New_York"

console.log("\n1 · Should this cycle run? (rulings 1 and 3)")
const idle = { visibilityState: "visible", busy: false, refreshing: false, online: true }
check("1  visible and idle → runs", shouldRunCycle(idle), true)
check("2  hidden → skips", shouldRunCycle({ ...idle, visibilityState: "hidden" }), false)
check(
  "3  busy because a sheet is open → skips",
  shouldRunCycle({ ...idle, busy: isBusy(new Map([["tasks:sheet", true]]).values(), 0) }),
  false
)
check("4  busy because a write is in flight → skips", shouldRunCycle({ ...idle, busy: isBusy([], 1) }), false)
check("5  already refreshing → skips", shouldRunCycle({ ...idle, refreshing: true }), false)
check("5a nothing registered and no write → not busy", isBusy([], 0), false)
check("5b a flag turned off → not busy", isBusy([false], 0), false)
check("5c the cadence is TAB-2's 60s", TABLET_REFRESH_MS, 60_000)
check("5d offline (navigator.onLine false), otherwise visible and idle → skips", shouldRunCycle({ ...idle, online: false }), false)
check("5e back online → runs", shouldRunCycle({ ...idle, online: true }), true)
check("5f offline → no single router.refresh() either (the post-write path)", mayRefreshServer(false), false)
check("5g online → the single refresh goes out", mayRefreshServer(true), true)

console.log("\n2 · Has the store-local date changed? (ruling 2)")
// 2026-11-10 10:00 PST.
check("6  same store-local day → no rollover", dayRolledOver("2026-11-10", new Date("2026-11-10T18:00:00Z"), LA), false)
// 2026-11-11 00:05 PST.
check("7  store-local date changed → rollover", dayRolledOver("2026-11-10", new Date("2026-11-11T08:05:00Z"), LA), true)
// 2026-11-10 17:30 PST = 2026-11-11 01:30 UTC: UTC is on the 11th, Las Brisas is not.
check(
  "8  5:30 PM Pacific: UTC has rolled over, the store has not → no rollover",
  dayRolledOver("2026-11-10", new Date("2026-11-11T01:30:00Z"), LA),
  false
)
check("8a ...and that instant's store-local day is still the 10th", storeLocalDay(new Date("2026-11-11T01:30:00Z"), LA), "2026-11-10")
// 2026-11-10 23:59:59 PST — the last second of the day.
check("8b 11:59:59 PM Pacific → no rollover", dayRolledOver("2026-11-10", new Date("2026-11-11T07:59:59Z"), LA), false)
check("8c midnight Pacific exactly → rollover", dayRolledOver("2026-11-10", new Date("2026-11-11T08:00:00Z"), LA), true)

// DST ended 2026-11-01 at 02:00 PDT (UTC-7 → UTC-8). 11:30 PM PST on the 1st
// is 07:30 UTC on the 2nd; a fixed PDT offset would put it at 00:30 on the
// 2nd and roll over an hour early.
check(
  "9  daylight-saving end day: 11:30 PM PST on Nov 1 → still Nov 1, no rollover",
  dayRolledOver("2026-11-01", new Date("2026-11-02T07:30:00Z"), LA),
  false
)
check(
  "9a ...and 12:30 AM PST on Nov 2 → rollover",
  dayRolledOver("2026-11-01", new Date("2026-11-02T08:30:00Z"), LA),
  true
)
// DST began 2026-03-08 at 02:00 PST (UTC-8 → UTC-7). 11:30 PM PDT on the 8th
// is 06:30 UTC on the 9th; a fixed PST offset would read 10:30 PM — right by
// luck — so the case that bites is just after midnight: 00:30 PDT on the 9th
// is 07:30 UTC, which a fixed PST offset reads as 11:30 PM on the 8th.
check(
  "10 daylight-saving start: 12:30 AM PDT on Mar 9 → rollover",
  dayRolledOver("2026-03-08", new Date("2026-03-09T07:30:00Z"), LA),
  true
)
check(
  "10a ...and 11:30 PM PDT on Mar 8 → no rollover",
  dayRolledOver("2026-03-08", new Date("2026-03-09T06:30:00Z"), LA),
  false
)
// The store's zone, not the browser's or a default: 9:30 PM Pacific is
// 12:30 AM in New York.
check(
  "11 a New York store rolls over at ITS midnight, while LA has not",
  [
    dayRolledOver("2026-11-10", new Date("2026-11-11T05:30:00Z"), NY),
    dayRolledOver("2026-11-10", new Date("2026-11-11T05:30:00Z"), LA),
  ],
  [true, false]
)
check(
  "12 forward only: a device clock behind the server never reads as a rollover",
  dayRolledOver("2026-11-11", new Date("2026-11-11T07:59:00Z"), LA),
  false
)

console.log("\n3 · The client's day is the server's day")
const instants = [
  "2026-11-10T18:00:00Z",
  "2026-11-11T01:30:00Z",
  "2026-11-11T07:59:59Z",
  "2026-11-11T08:00:00Z",
  "2026-11-02T07:30:00Z",
  "2026-11-02T08:30:00Z",
  "2026-03-09T06:30:00Z",
  "2026-03-09T07:30:00Z",
  "2026-11-11T05:30:00Z",
]
const disagreements = instants.flatMap((iso) =>
  [LA, NY].filter((tz) => storeLocalDay(new Date(iso), tz) !== localDateStr(new Date(iso), tz)).map((tz) => `${iso} ${tz}`)
)
check(`13 storeLocalDay === reports.localDateStr on ${instants.length * 2} instant/zone pairs`, disagreements, [])

console.log("\n4 · Which day the page shows (rulings 2 and 3)")
check(
  "14 the server moved on, page idle → move to the server's day",
  nextShownDay("2026-11-10", "2026-11-11", false),
  "2026-11-11"
)
check("14a the server moved on, a sheet open → stay until idle", nextShownDay("2026-11-10", "2026-11-11", true), "2026-11-10")
check("14b the server has not moved → stay", nextShownDay("2026-11-10", "2026-11-10", false), "2026-11-10")

console.log("\n5 · Local ticks give way to the server (ruling 4)")
const T = 1_000_000
const ov: Record<string, TickOverride> = {
  "c:inflight": { done: true, value: null },
  "c:before": { done: true, value: null, settledAt: T - 5 },
  "c:same": { done: true, value: 38, settledAt: T },
  "c:after": { done: false, value: null, settledAt: T + 5 },
}
check(
  "15 a read that began after a tick settled retires it; in-flight, same-ms and later ticks stay",
  Object.keys(pruneOverrides(ov, T)).sort(),
  ["c:after", "c:inflight", "c:same"]
)
check("15a nothing to retire → the same object (no re-render)", pruneOverrides(ov, 0) === ov, true)
check("15b no read has landed yet (0) → nothing retired", Object.keys(pruneOverrides(ov, 0)).length, 4)
check("15c the input is not mutated", Object.keys(ov).length, 4)

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
