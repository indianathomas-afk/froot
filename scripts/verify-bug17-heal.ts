/**
 * BUG-17 acceptance fixture — heal stale open timecards by id; the 24h guard.
 *
 *   npx tsx scripts/verify-bug17-heal.ts
 *
 * Rulings: docs/DECISIONS.md 2026-10-31 "TIMECARD-HEAL-0" (R1–R5) and
 * "BUG-17" (rulings 1–5). MADE-UP DATA THROUGHOUT: dev held 0 timecards on
 * 2026-10-31 (TIMECARD-HEAL-0 audit A5), so nothing here is a real card.
 *
 *   A. THE BOUNDARY TEST. With no open card older than 24h, every number —
 *      labor %, cost, tips, on-time, the Day Inspector, the clocked-in curve and
 *      roster — is byte-identical to scripts/bug17-boundary-golden.json, written
 *      at 84e7f6c before any BUG-17 code existed. That is production's state
 *      today, so production's numbers do not move.
 *   B. THE GUARD (pure, injected clock). A stale open card adds nothing to labor
 *      % / cost / hours / tips, is not "on the clock", covers no day, never pairs
 *      as attendance, and leaves its shift out of on-time when it is the only
 *      possible clock-in. A card open under 24h — someone mid-shift — still
 *      counts, and so does one open exactly 24h.
 *   C. THE INSPECTOR. Stale cards keep the "Open, stale" bar but add no paid
 *      hours, no Double, no Unscheduled, no No-show on a shift they claim; the
 *      notice is Gary's wording. An open card from yesterday is clipped to the
 *      viewed day (R5); a closed midnight-crossing card is not (ruling 4).
 *   D. THE HEAL (DEV DATABASE ONLY, mocked Square). A stale card heals to CLOSED
 *      with Square's clock-out; an older version is discarded; a 404 is logged
 *      and leaves the row (only syncedAt moves); the cap of 25 holds and the rest
 *      is deferred; a Square 500 mid-heal does not fail the sync; only GETs are
 *      sent by id. Every row is removed and the count asserted to be 0.
 */
import "dotenv/config"
import { readFileSync } from "fs"
import { prisma } from "../src/lib/prisma"
import {
  HEAL_CAP,
  computeLaborActuals,
  computeTipPayout,
  isStaleOpen,
  syncTimecardsForStore,
  type LaborActualsTimecard,
  type TipTimecard,
} from "../src/lib/labor-actuals"
import { laborFootnotes, toLaborBlock } from "../src/lib/labor-judgment"
import { assembleDayInspector, type InspectorShiftRow, type InspectorTimecardRow } from "../src/lib/labor-inspector"
import { assembleOnTime, type AttendanceCard, type AttendanceShift } from "../src/lib/attendance"
import { DEFAULT_MILESTONE_SETTINGS } from "../src/lib/attendance-settings"
import { assembleClockedInRoster, computeClockedInCoverage } from "../src/lib/labor-schedule"
import { localDateStr } from "../src/lib/reports"
import { GOLDEN_PATH, computeBoundary } from "./bug17-boundary"

let failures = 0
let passes = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${a}${ok ? "" : ` (expected ${e})`}`)
}

// All instants UTC (CLAUDE.md § "A DATABASE TIMESTAMP IS UTC"). PDT = UTC−7.
const utc = (s: string) => new Date(`${s}Z`)
const TZ = "America/Los_Angeles"
const NOW = utc("2026-08-18T20:00:00.000") // 1:00p PDT, Aug 18
const DAY_END = utc("2026-08-19T07:00:00.000")
const SYNC_OK = utc("2026-08-18T19:50:00.000")
const H = 60 * 60 * 1000

// ─── A ────────────────────────────────────────────────────────────────────────
console.log("\nA. Boundary — no open card over 24h: every number byte-identical to HEAD")
check(
  "A1. labor %, cost, tips, on-time, Inspector, curve, roster === bug17-boundary-golden.json",
  JSON.stringify(computeBoundary(), null, 2) + "\n" === readFileSync(GOLDEN_PATH, "utf8"),
  true
)

// ─── B ────────────────────────────────────────────────────────────────────────
console.log("\nB. The 24h guard (pure, injected clock)")
const open = (startAt: Date, o: Partial<LaborActualsTimecard> = {}): LaborActualsTimecard => ({
  startAt,
  endAt: null,
  breakUnpaidMinutes: 0,
  wageHourlyRate: 18,
  ...o,
})
check("B1. open 23h59m is not stale", isStaleOpen(open(new Date(NOW.getTime() - 24 * H + 60000)), NOW.getTime()), false)
check("B2. open exactly 24h is not stale (STRICTLY older)", isStaleOpen(open(new Date(NOW.getTime() - 24 * H)), NOW.getTime()), false)
check("B3. open 24h + 1ms is stale", isStaleOpen(open(new Date(NOW.getTime() - 24 * H - 1)), NOW.getTime()), true)
check("B4. a closed card is never stale", isStaleOpen({ startAt: utc("2026-08-01T16:00:00.000"), endAt: utc("2026-08-01T20:00:00.000") }, NOW.getTime()), false)

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"))
const BASE: LaborActualsTimecard[] = [
  { startAt: utc("2026-08-18T15:02:00.000"), endAt: utc("2026-08-18T19:30:00.000"), breakUnpaidMinutes: 30, wageHourlyRate: 18 },
  { startAt: utc("2026-08-18T16:10:00.000"), endAt: utc("2026-08-18T19:45:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: null },
  { startAt: utc("2026-08-18T17:00:00.000"), endAt: null, breakUnpaidMinutes: 0, wageHourlyRate: 20 },
  { startAt: utc("2026-08-18T14:00:00.000"), endAt: utc("2026-08-18T17:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 18 },
  { startAt: utc("2026-08-18T16:30:00.000"), endAt: utc("2026-08-18T18:00:00.000"), breakUnpaidMinutes: 0, wageHourlyRate: 18 },
]
// Opened 2026-08-17 10:00Z and never closed in Froot: 34h old at NOW.
const STALE = open(utc("2026-08-17T10:00:00.000"), { wageHourlyRate: 25 })
const args = { netSales: 1234.56, now: NOW, windowEnd: DAY_END, syncState: { lastSyncOkAt: SYNC_OK, lastError: null } }
const withStale = computeLaborActuals({ timecards: [...BASE, STALE], ...args })
const { staleOpenCount, ...restWithStale } = withStale
check("B5. a stale card adds $0 to labor cost", withStale.laborCost, golden.laborToday.laborCost)
check("B6. …0 hours", withStale.laborHours, golden.laborToday.laborHours)
check("B7. …0 to labor %", withStale.laborPct, golden.laborToday.laborPct)
check("B8. …and is not counted 'on the clock'", withStale.openTimecardCount, golden.laborToday.openTimecardCount)
check("B9. it is counted apart as staleOpenCount", staleOpenCount, 1)
check(
  "B10. every other field equals the no-stale result except timecardCount",
  { ...restWithStale, timecardCount: 0 },
  { ...golden.laborToday, timecardCount: 0 }
)
check("B11. staleOpenCount is ABSENT (not 0) with no stale card", "staleOpenCount" in golden.laborToday, false)
const midShift = computeLaborActuals({ timecards: [open(utc("2026-08-18T17:00:00.000"), { wageHourlyRate: 20 })], ...args })
check("B12. a card open 3h (someone mid-shift) still counts: hours", midShift.laborHours, 3)
check("B13. …and cost", midShift.laborCost, 60)
const day = computeLaborActuals({ timecards: [open(new Date(NOW.getTime() - 24 * H), { wageHourlyRate: 10 })], ...args, windowEnd: NOW })
check("B14. a card open exactly 24h still counts", day.laborHours, 24)

const TIP_BASE: TipTimecard[] = BASE.map((c) => ({ ...c, declaredCashTips: null, wageTipEligible: true }))
const tipsBase = computeTipPayout({ timecards: TIP_BASE, posTips: 61.2, now: NOW, windowEnd: DAY_END })
const tipsStale = computeTipPayout({
  timecards: [...TIP_BASE, { ...STALE, declaredCashTips: null, wageTipEligible: true }],
  posTips: 61.2,
  now: NOW,
  windowEnd: DAY_END,
})
check("B15. a stale card adds no hours to the tips divisor", tipsStale.eligibleHours, tipsBase.eligibleHours)

const block = toLaborBlock(withStale, 20, true)
check("B16. the labor block carries staleOpenCount", block.staleOpenCount, 1)
check("B17. …and absent with none", "staleOpenCount" in toLaborBlock(golden.laborToday, 20, true), false)
check(
  "B18. dashboard note, Gary's wording (one card)",
  laborFootnotes(block).find((n) => n.text.includes("24 hours"))?.text,
  "1 timecard has been open more than 24 hours and isn't counted — labor cost may read low until Square confirms the clock-out."
)
check(
  "B19. dashboard note, Gary's wording (N cards)",
  laborFootnotes({ ...block, staleOpenCount: 3 }).find((n) => n.text.includes("24 hours"))?.text,
  "3 timecards have been open more than 24 hours and aren't counted — labor cost may read low until Square confirms the clock-out."
)

// On-time (R1 + ruling 3).
const STORE = "s1"
const onTimeFor = (memberShifts: AttendanceShift[], memberCards: AttendanceCard[]) =>
  assembleOnTime({
    squareTeamMemberId: "mA",
    assignedStoreIds: [STORE],
    memberShifts,
    memberCards,
    storesWithSchedule: new Set([STORE]),
    storeZones: new Map([[STORE, TZ]]),
    syncedThroughByStore: new Map([[STORE, SYNC_OK.getTime()]]),
    range: { from: "2026-08-01", to: "2026-08-18" },
    now: NOW,
    settings: { ...DEFAULT_MILESTONE_SETTINGS, onTimeMinShifts: 1 },
  })
const shift = (start: string, end: string): AttendanceShift => ({
  storeId: STORE,
  effectiveTeamMemberId: "mA",
  effectiveStartAt: utc(start),
  effectiveEndAt: utc(end),
  effectiveSource: "published",
  effectiveIsDeleted: false,
})
const aCard = (start: string, end: string | null): AttendanceCard => ({
  storeId: STORE,
  squareTeamMemberId: "mA",
  startAt: utc(start),
  endAt: end ? utc(end) : null,
})
// THE AUDIT'S DEFECT: a card frozen open on Aug 10 paired with Aug 18's shift and
// made it "on time". Now it pairs with nothing, and it started >24h before the
// shift, so it is not a possible clock-in either — the shift is a no-show.
const frozen = onTimeFor([shift("2026-08-18T15:00:00.000", "2026-08-18T19:00:00.000")], [aCard("2026-08-10T16:00:00.000", null)])
check("B20. a frozen Aug 10 card no longer makes Aug 18 'on time'", [frozen.onTime, frozen.total], [0, 1])
// Ruling 3: its own shift (started within 24h before, before the end) is unknown.
const claimed = onTimeFor(
  [shift("2026-08-17T19:00:00.000", "2026-08-17T23:00:00.000"), shift("2026-08-18T15:00:00.000", "2026-08-18T19:00:00.000")],
  [aCard("2026-08-17T19:02:00.000", null), aCard("2026-08-18T15:03:00.000", "2026-08-18T19:00:00.000")]
)
check("B21. the shift a stale card claims is left out; the real one counts", [claimed.onTime, claimed.total], [1, 1])
const stillOpen = onTimeFor([shift("2026-08-18T15:00:00.000", "2026-08-18T19:00:00.000")], [aCard("2026-08-18T15:04:00.000", null)])
check("B22. a card open 5h still pairs and is on time", [stillOpen.onTime, stillOpen.total], [1, 1])

// Clocked-in curve and roster.
const covRow = (startAt: Date) => ({ startAt, endAt: null, breakUnpaidMinutes: 0, wageJobId: "job-a" })
check(
  "B23. the clocked-in curve drops a card open over 24h",
  computeClockedInCoverage({ rows: [covRow(utc("2026-08-17T19:00:00.000"))], date: "2026-08-18", timeZone: TZ, now: NOW }).timecardCount,
  0
)
const rosterRow = (startAt: Date) => ({ squareTeamMemberId: "mA", startAt, wageTitle: "Crew", breakUnpaidMinutes: 0 })
check(
  "B24. the roster drops it too, and keeps a card open 3h",
  assembleClockedInRoster({
    rows: [rosterRow(utc("2026-08-17T19:00:00.000")), rosterRow(utc("2026-08-18T17:00:00.000"))],
    namesBySquareId: new Map([["mA", "Avery"]]),
    timeZone: TZ,
    now: NOW,
  }).length,
  1
)

// ─── C ────────────────────────────────────────────────────────────────────────
console.log("\nC. The Day Inspector (2026-08-18, viewed at 1:00p PDT)")
const iRow = (member: string, start: string, end: string | null, o: Partial<InspectorTimecardRow> = {}): InspectorTimecardRow => ({
  squareTeamMemberId: member,
  startAt: utc(start),
  endAt: end ? utc(end) : null,
  status: end ? "CLOSED" : "OPEN",
  breakPaidMinutes: 0,
  breakUnpaidMinutes: 0,
  wageJobId: "job-a",
  wageTitle: "Crew",
  ...o,
})
const iShift = (member: string, start: string, end: string): InspectorShiftRow => ({
  effectiveTeamMemberId: member,
  effectiveStartAt: utc(start),
  effectiveEndAt: utc(end),
  effectiveJobId: "job-a",
  effectiveSource: "published",
  effectiveIsDeleted: false,
})
const insp = assembleDayInspector({
  timecards: [
    // m7: two cards frozen open since Aug 15 and Aug 16 — the staging picture.
    iRow("m7", "2026-08-15T16:00:00.000", null),
    iRow("m7", "2026-08-16T17:00:00.000", null),
    // m9: frozen open since Aug 17 15:30Z, 15.5h before its night shift.
    iRow("m9", "2026-08-17T15:30:00.000", null),
    // m8: opened yesterday 8:00p PDT, 17h ago — under 24h, so it counts (R5 clips).
    iRow("m8", "2026-08-18T03:00:00.000", null, { breakUnpaidMinutes: 60 }),
    // m6: CLOSED 10:00p → 2:00a PDT — whole-card hours stay (ruling 4).
    iRow("m6", "2026-08-18T05:00:00.000", "2026-08-18T09:00:00.000"),
  ],
  shifts: [
    iShift("m7", "2026-08-18T15:00:00.000", "2026-08-18T19:00:00.000"),
    iShift("m9", "2026-08-18T07:30:00.000", "2026-08-18T12:00:00.000"),
    iShift("m8", "2026-08-18T03:00:00.000", "2026-08-18T20:00:00.000"),
    iShift("m6", "2026-08-18T05:00:00.000", "2026-08-18T09:00:00.000"),
  ],
  namesBySquareId: new Map([
    ["m6", "Frankie"],
    ["m7", "Gray"],
    ["m8", "Harper"],
    ["m9", "Indy"],
  ]),
  date: "2026-08-18",
  timeZone: TZ,
  now: NOW,
  hasSchedule: true,
  timecardSyncOkAt: SYNC_OK,
  durationSuppressed: false,
})
const person = (name: string) => insp.people.find((p) => p.name === name)!
check("C1. stale cards keep the 'Open, stale' flag", person("Gray").flags.includes("OPEN-STALE"), true)
check("C2. two stale cards are not 'Double'", person("Gray").flags.includes("DOUBLE"), false)
check("C3. a stale card is not 'Unscheduled'", person("Gray").flags.includes("UNSCHEDULED"), false)
check("C4. both stale bars are still drawn, open", person("Gray").bars.map((b) => b.open), [true, true])
check("C5. stale cards add no paid hours, and say how many are unknown", person("Gray").paidLabel, "0.0h paid · 2 unknown")
check("C6. a stale bar's detail says hours unknown", person("Gray").bars[0].detail.endsWith("open over 24h — hours unknown"), true)
check("C7. a stale card >24h before the shift does not claim it: still a no-show", person("Gray").flags.includes("NO-SHOW"), true)
check("C8. a stale card within 24h before the shift claims it: no No-show", person("Indy").flags.includes("NO-SHOW"), false)
check("C9. …and Indy's paid label", person("Indy").paidLabel, "0.0h paid · 1 unknown")
// 780 kept of 1020 min since clock-in; 60 × 780/1020 = 45.88 min of break comes out.
check("C10. R5: an open card from yesterday counts only the viewed day (12.2h, not 16.0h)", person("Harper").paidLabel, "12.2h paid")
check("C11. ruling 4: a closed midnight-crossing card keeps whole-card hours", person("Frankie").paidLabel, "4.0h paid")
check(
  "C12. the notice, Gary's wording",
  insp.notices.find((n) => n.code === "stale-open")?.text,
  "3 timecards have been open more than 24 hours. They're shown but not counted in paid hours, Double, Unscheduled or No-show until Square confirms the clock-out."
)
const one = assembleDayInspector({
  timecards: [iRow("m7", "2026-08-15T16:00:00.000", null)],
  shifts: [],
  namesBySquareId: new Map([["m7", "Gray"]]),
  date: "2026-08-18",
  timeZone: TZ,
  now: NOW,
  hasSchedule: false,
  timecardSyncOkAt: SYNC_OK,
  durationSuppressed: false,
})
check(
  "C13. the notice, one card",
  one.notices.find((n) => n.code === "stale-open")?.text,
  "1 timecard has been open more than 24 hours. It's shown but not counted in paid hours, Double, Unscheduled or No-show until Square confirms the clock-out."
)

// ─── D ────────────────────────────────────────────────────────────────────────
type Call = { method: string; url: string }

async function heal() {
  console.log("\nD. The heal (dev database, mocked Square)")
  const [env] = await prisma.$queryRawUnsafe<{ neon_branch_id: string | null }[]>(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id"
  )
  console.log(`  Neon branch: ${env?.neon_branch_id ?? "UNKNOWN"}`)
  const DEV_BRANCH = "br-broad-wave-a6vpjdw0"
  if (env?.neon_branch_id !== DEV_BRANCH) {
    console.error(`  REFUSING TO RUN D: expected the dev branch ${DEV_BRANCH}, got ${env?.neon_branch_id}.`)
    failures++
    return
  }

  const tag = Date.now().toString(36)
  // No refresh token, so getSquareClient never calls /oauth2/token.
  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-bug17-${tag}`,
      name: "ZZ BUG-17 Fixture Org (safe to delete)",
      activeModules: ["labor"],
      squareAccessToken: "bug17-fixture-token-not-real",
    },
  })
  console.log(`  Fixture org ${org.id}`)

  const calls: Call[] = []
  const logs: string[] = []
  const realFetch = globalThis.fetch
  const realLog = console.log
  let byId: (id: string) => { status: number; body?: unknown } = () => ({ status: 404 })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    calls.push({ method, url })
    if (url.endsWith("/v2/labor/timecards/search")) return new Response(JSON.stringify({ timecards: [] }), { status: 200 })
    const m = url.match(/\/v2\/labor\/timecards\/([^/?]+)$/)
    if (m && method === "GET") {
      const r = byId(decodeURIComponent(m[1]))
      return new Response(r.body === undefined ? JSON.stringify({ errors: [{ code: "NOT_FOUND" }] }) : JSON.stringify(r.body), {
        status: r.status,
      })
    }
    throw new Error(`BUG-17 fixture: unexpected fetch ${method} ${url}`)
  }) as typeof fetch
  console.log = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "))
  }

  const results: [string, unknown, unknown][] = []
  const expect = (label: string, actual: unknown, expected: unknown) => results.push([label, actual, expected])

  try {
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "ZZ BUG-17 Store", timezone: TZ, squareLocationId: `ZZBUG17LOC${tag}` },
    })
    const now = new Date()
    const old = (days: number) => new Date(now.getTime() - days * 24 * H)
    const seed = (id: string, startAt: Date, version = 3, syncedAt = old(30)) =>
      prisma.squareTimecard.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          squareTimecardId: id,
          squareTeamMemberId: "ZZTM",
          squareLocationId: store.squareLocationId!,
          startAt,
          endAt: null,
          status: "OPEN",
          squareVersion: version,
          squareCreatedAt: startAt,
          squareUpdatedAt: startAt,
          syncedAt,
        },
      })
    const squareCard = (id: string, startAt: Date, version: number) => ({
      id,
      location_id: store.squareLocationId,
      team_member_id: "ZZTM",
      start_at: startAt.toISOString(),
      end_at: new Date(startAt.getTime() + 6 * H).toISOString(),
      status: "CLOSED",
      version,
      created_at: startAt.toISOString(),
      updated_at: new Date(startAt.getTime() + 6 * H).toISOString(),
    })

    // ── run 1: heal, version guard, 404, in-window card untouched ──
    await seed("ZZ-HEAL", old(5), 3)
    await seed("ZZ-OLDER", old(4), 3)
    await seed("ZZ-GONE", old(3), 3)
    // Opened 30 seconds ago — inside today's window, so the heal must not ask about it.
    const today = await seed("ZZ-TODAY", new Date(now.getTime() - 30_000), 1)
    const goneBefore = await prisma.squareTimecard.findFirstOrThrow({ where: { organizationId: org.id, squareTimecardId: "ZZ-GONE" } })
    const healStart = old(5)
    byId = (id) => {
      if (id === "ZZ-HEAL") return { status: 200, body: { timecard: squareCard(id, healStart, 4) } }
      if (id === "ZZ-OLDER") return { status: 200, body: { timecard: squareCard(id, old(4), 2) } }
      return { status: 404 }
    }
    const todayStr = localDateStr(now, TZ)
    const r1 = await syncTimecardsForStore(org, store, todayStr, todayStr)
    const healed = await prisma.squareTimecard.findFirstOrThrow({ where: { organizationId: org.id, squareTimecardId: "ZZ-HEAL" } })
    const older = await prisma.squareTimecard.findFirstOrThrow({ where: { organizationId: org.id, squareTimecardId: "ZZ-OLDER" } })
    const gone = await prisma.squareTimecard.findFirstOrThrow({ where: { organizationId: org.id, squareTimecardId: "ZZ-GONE" } })
    expect("D1. a stale open card heals to CLOSED", healed.status, "CLOSED")
    expect("D2. …with Square's clock-out", healed.endAt?.toISOString(), new Date(healStart.getTime() + 6 * H).toISOString())
    expect("D3. …and Square's version", healed.squareVersion, 4)
    expect("D4. an older Square version is discarded (row stays open)", [older.endAt, older.squareVersion], [null, 3])
    expect("D5. a 404 leaves the card open", gone.endAt, null)
    expect("D6. …and changes nothing but syncedAt", [gone.status, gone.squareVersion, gone.updatedAt.toISOString()], [goneBefore.status, goneBefore.squareVersion, goneBefore.updatedAt.toISOString()])
    expect("D7. …syncedAt moved, so it rotates to the back (ruling 2)", gone.syncedAt > goneBefore.syncedAt, true)
    expect("D8. the 404 is logged", logs.some((l) => l.includes("heal 404 timecard=ZZ-GONE left as is")), true)
    expect("D9. the heal result", r1.healed, { candidates: 3, checked: 3, closed: 1, notFound: 1, deferred: 0, stopped: null })
    expect("D10. the in-window open card was not asked about", calls.some((c) => c.url.endsWith("/ZZ-TODAY")), false)
    expect("D11. …and is untouched", (await prisma.squareTimecard.findUniqueOrThrow({ where: { id: today.id } })).endAt, null)

    // ── run 2: the cap ──
    await prisma.squareTimecard.deleteMany({ where: { organizationId: org.id } })
    await prisma.squareLaborSyncState.deleteMany({ where: { storeId: store.id } })
    for (let i = 0; i < 30; i++) await seed(`ZZ-CAP-${String(i).padStart(2, "0")}`, old(10 + i), 3, old(30 - i / 100))
    calls.length = 0
    byId = () => ({ status: 404 })
    const r2 = await syncTimecardsForStore(org, store, todayStr, todayStr)
    const gets = calls.filter((c) => c.method === "GET").length
    expect("D12. the cap: at most 25 cards asked about per run", [gets, HEAL_CAP], [25, 25])
    expect("D13. the other 5 are logged as deferred", [r2.healed.checked, r2.healed.deferred], [25, 5])
    expect("D14. the deferral line is logged", logs.some((l) => l.includes("heal: 25 checked, 0 closed, 25 404, 5 deferred")), true)
    calls.length = 0
    await syncTimecardsForStore(org, store, todayStr, todayStr)
    const second = new Set(calls.filter((c) => c.method === "GET").map((c) => c.url.split("/").pop()))
    expect("D15. the next run reaches the 5 it deferred (least recently checked first)", ["25", "26", "27", "28", "29"].every((n) => second.has(`ZZ-CAP-${n}`)), true)

    // ── run 3: a Square error mid-heal ──
    await prisma.squareTimecard.deleteMany({ where: { organizationId: org.id } })
    for (let i = 0; i < 3; i++) await seed(`ZZ-ERR-${i}`, old(6 + i))
    byId = () => ({ status: 500, body: { errors: [{ code: "INTERNAL_SERVER_ERROR" }] } })
    let threw = false
    let r3
    try {
      r3 = await syncTimecardsForStore(org, store, todayStr, todayStr)
    } catch {
      threw = true
    }
    const state = await prisma.squareLaborSyncState.findUniqueOrThrow({ where: { storeId: store.id } })
    expect("D16. a Square 500 mid-heal does not fail the sync", threw, false)
    expect("D17. …the heal says it stopped", r3?.healed.stopped, "SQUARE_TIMECARD_500")
    expect("D18. …and the store stays healthy (no lastError)", [state.lastError, state.lastSyncOkAt !== null], [null, true])

    // ── read-only toward Square ──
    const methods = [...new Set(calls.map((c) => `${c.method} ${c.url.replace(/\/v2\/labor\/timecards\/(?!search$).+$/, "/v2/labor/timecards/{id}").replace(/^https:\/\/[^/]+/, "")}`))].sort()
    expect("D19. only the search and GET-by-id are ever sent", methods, ["GET /v2/labor/timecards/{id}", "POST /v2/labor/timecards/search"])
  } finally {
    globalThis.fetch = realFetch
    console.log = realLog
    await prisma.squareTimecard.deleteMany({ where: { organizationId: org.id } })
    await prisma.squareLaborSyncState.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
  }
  for (const [l, a, e] of results) check(l, a, e)
  const left = await Promise.all([
    prisma.organization.count({ where: { clerkOrgId: { startsWith: "fixture-bug17-" } } }),
    prisma.store.count({ where: { name: "ZZ BUG-17 Store" } }),
    prisma.squareTimecard.count({ where: { squareTimecardId: { startsWith: "ZZ-" } } }),
  ])
  check("D20. no rows left behind (orgs, stores, timecards)", left, [0, 0, 0])
}

heal()
  .catch((e) => {
    failures++
    console.error("  ✗ D threw:", e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\nBUG-17: ${passes} passed, ${failures} failed`)
    process.exit(failures === 0 ? 0 : 1)
  })
