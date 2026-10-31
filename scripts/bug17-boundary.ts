/**
 * BUG-17 — THE BOUNDARY TEST'S DATA AND ITS GOLDEN.
 *
 *   npx tsx scripts/bug17-boundary.ts --write   # ONLY at the pre-BUG-17 HEAD
 *
 * Production held 0 open timecards older than 24h on 2026-10-31
 * (br-sparkling-block-a620qvg4), so every number production shows today must
 * be byte-identical before and after BUG-17. This module builds a made-up
 * store-day with NO open card older than 24h and runs it through every
 * top-level reader the guard touches: labor % / cost, tips, on-time, the Day
 * Inspector, the clocked-in curve and the roster. `--write` saved the result to
 * scripts/bug17-boundary-golden.json at 84e7f6c, before any BUG-17 code
 * existed; scripts/verify-bug17-heal.ts recomputes it and compares the string.
 *
 * Only the top-level functions are called, never clockedEndMs / paidMinutesOf,
 * because BUG-17 changes those two signatures and this file must run unchanged
 * on both sides of the change.
 *
 * Every instant is UTC (CLAUDE.md § "A DATABASE TIMESTAMP IS UTC"). The store
 * is America/Los_Angeles, PDT = UTC−7, so 2026-08-18 runs 07:00Z → 07:00Z.
 */
import { writeFileSync } from "fs"
import { computeLaborActuals, computeTipPayout } from "../src/lib/labor-actuals"
import { assembleDayInspector, type InspectorShiftRow, type InspectorTimecardRow } from "../src/lib/labor-inspector"
import { assembleOnTime, type AttendanceCard, type AttendanceShift } from "../src/lib/attendance"
import { DEFAULT_MILESTONE_SETTINGS } from "../src/lib/attendance-settings"
import { assembleClockedInRoster, computeClockedInCoverage } from "../src/lib/labor-schedule"

const utc = (s: string) => new Date(`${s}Z`)
const TZ = "America/Los_Angeles"
const DATE = "2026-08-18"
const NOW = utc("2026-08-18T20:00:00.000") // 1:00p PDT
const DAY_END = utc("2026-08-19T07:00:00.000")
const PRIOR_DAY_END = utc("2026-08-18T07:00:00.000")
const SYNC_OK = utc("2026-08-18T19:50:00.000")
const STORE = "store-bug17"

type Card = InspectorTimecardRow & { wageHourlyRate: number | null; declaredCashTips: number | null; wageTipEligible: boolean | null }
const card = (c: Partial<Card> & Pick<Card, "squareTeamMemberId" | "startAt" | "endAt">): Card => ({
  status: c.endAt === null ? "OPEN" : "CLOSED",
  breakPaidMinutes: 0,
  breakUnpaidMinutes: 0,
  wageJobId: "job-a",
  wageTitle: "Crew",
  wageHourlyRate: 18,
  declaredCashTips: null,
  wageTipEligible: true,
  ...c,
})

// THE DAY. Same-day closed cards, a break, a missing wage, a DOUBLE, an open
// card under 24h, and one closed card crossing midnight INTO the viewed day.
const TODAY_CARDS: Card[] = [
  card({ squareTeamMemberId: "m1", startAt: utc("2026-08-18T15:02:00.000"), endAt: utc("2026-08-18T19:30:00.000"), breakUnpaidMinutes: 30, declaredCashTips: 12.5 }),
  card({ squareTeamMemberId: "m2", startAt: utc("2026-08-18T16:10:00.000"), endAt: utc("2026-08-18T19:45:00.000"), wageHourlyRate: null, wageTipEligible: null }),
  card({ squareTeamMemberId: "m3", startAt: utc("2026-08-18T17:00:00.000"), endAt: null, wageHourlyRate: 20, breakPaidMinutes: 10 }),
  card({ squareTeamMemberId: "m4", startAt: utc("2026-08-18T14:00:00.000"), endAt: utc("2026-08-18T17:00:00.000"), wageTipEligible: false }),
  card({ squareTeamMemberId: "m4", startAt: utc("2026-08-18T16:30:00.000"), endAt: utc("2026-08-18T18:00:00.000"), wageJobId: "job-b", wageTitle: "Lead" }),
]
const CROSSING: Card = card({ squareTeamMemberId: "m6", startAt: utc("2026-08-18T05:00:00.000"), endAt: utc("2026-08-18T09:00:00.000") })

const SHIFTS: InspectorShiftRow[] = [
  { effectiveTeamMemberId: "m1", effectiveStartAt: utc("2026-08-18T15:00:00.000"), effectiveEndAt: utc("2026-08-18T19:30:00.000"), effectiveJobId: "job-a", effectiveSource: "published", effectiveIsDeleted: false },
  { effectiveTeamMemberId: "m2", effectiveStartAt: utc("2026-08-18T16:00:00.000"), effectiveEndAt: utc("2026-08-18T20:00:00.000"), effectiveJobId: "job-a", effectiveSource: "published", effectiveIsDeleted: false },
  { effectiveTeamMemberId: "m3", effectiveStartAt: utc("2026-08-18T17:00:00.000"), effectiveEndAt: utc("2026-08-19T01:00:00.000"), effectiveJobId: "job-a", effectiveSource: "published", effectiveIsDeleted: false },
  { effectiveTeamMemberId: "m5", effectiveStartAt: utc("2026-08-18T15:00:00.000"), effectiveEndAt: utc("2026-08-18T19:00:00.000"), effectiveJobId: "job-a", effectiveSource: "published", effectiveIsDeleted: false },
  { effectiveTeamMemberId: "m6", effectiveStartAt: utc("2026-08-18T05:00:00.000"), effectiveEndAt: utc("2026-08-18T09:00:00.000"), effectiveJobId: "job-a", effectiveSource: "published", effectiveIsDeleted: false },
  { effectiveTeamMemberId: null, effectiveStartAt: utc("2026-08-18T22:00:00.000"), effectiveEndAt: utc("2026-08-19T02:00:00.000"), effectiveJobId: "job-a", effectiveSource: "published", effectiveIsDeleted: false },
]

const NAMES = new Map([
  ["m1", "Avery"],
  ["m2", "Blake"],
  ["m3", "Casey"],
  ["m4", "Devon"],
  ["m5", "Emery"],
])

export function computeBoundary() {
  const laborToday = computeLaborActuals({
    timecards: TODAY_CARDS,
    netSales: 1234.56,
    now: NOW,
    windowEnd: DAY_END,
    syncState: { lastSyncOkAt: SYNC_OK, lastError: null },
  })
  const laborTwoDays = computeLaborActuals({
    timecards: [...TODAY_CARDS, CROSSING],
    netSales: 2469.12,
    now: NOW,
    windowEnd: DAY_END,
    syncState: { lastSyncOkAt: SYNC_OK, lastError: null },
    daysCovered: 2,
    daysInWindow: 2,
  })
  const laborPriorDay = computeLaborActuals({
    timecards: [CROSSING],
    netSales: 800,
    now: NOW,
    windowEnd: PRIOR_DAY_END,
    syncState: null,
  })
  const tips = computeTipPayout({ timecards: TODAY_CARDS, posTips: 61.2, now: NOW, windowEnd: DAY_END })

  const inspectorRows: InspectorTimecardRow[] = [...TODAY_CARDS, CROSSING].map((c) => ({
    squareTeamMemberId: c.squareTeamMemberId,
    startAt: c.startAt,
    endAt: c.endAt,
    status: c.status,
    breakPaidMinutes: c.breakPaidMinutes,
    breakUnpaidMinutes: c.breakUnpaidMinutes,
    wageJobId: c.wageJobId,
    wageTitle: c.wageTitle,
  }))
  const inspector = assembleDayInspector({
    timecards: inspectorRows,
    shifts: SHIFTS,
    namesBySquareId: NAMES,
    date: DATE,
    timeZone: TZ,
    now: NOW,
    hasSchedule: true,
    timecardSyncOkAt: SYNC_OK,
    durationSuppressed: false,
  })

  const attShifts: AttendanceShift[] = SHIFTS.map((s) => ({ storeId: STORE, ...s }))
  const attCards: AttendanceCard[] = [...TODAY_CARDS, CROSSING].map((c) => ({
    storeId: STORE,
    squareTeamMemberId: c.squareTeamMemberId,
    startAt: c.startAt,
    endAt: c.endAt,
  }))
  const onTime = Object.fromEntries(
    ["m1", "m2", "m3", "m5", "m6"].map((m) => [
      m,
      assembleOnTime({
        squareTeamMemberId: m,
        assignedStoreIds: [STORE],
        memberShifts: attShifts.filter((s) => s.effectiveTeamMemberId === m),
        memberCards: attCards.filter((c) => c.squareTeamMemberId === m),
        storesWithSchedule: new Set([STORE]),
        storeZones: new Map([[STORE, TZ]]),
        syncedThroughByStore: new Map([[STORE, SYNC_OK.getTime()]]),
        range: { from: "2026-08-01", to: DATE },
        now: NOW,
        settings: { ...DEFAULT_MILESTONE_SETTINGS, onTimeMinShifts: 1 },
      }),
    ])
  )

  const coverage = computeClockedInCoverage({ rows: [...TODAY_CARDS, CROSSING], date: DATE, timeZone: TZ, now: NOW })
  const roster = assembleClockedInRoster({
    rows: TODAY_CARDS.filter((c) => c.endAt === null).map((c) => ({
      squareTeamMemberId: c.squareTeamMemberId,
      startAt: c.startAt,
      wageTitle: c.wageTitle,
      breakUnpaidMinutes: c.breakUnpaidMinutes,
    })),
    namesBySquareId: NAMES,
    timeZone: TZ,
    now: NOW,
  })

  return { laborToday, laborTwoDays, laborPriorDay, tips, inspector, onTime, coverage, roster }
}

export const GOLDEN_PATH = "scripts/bug17-boundary-golden.json"

if (process.argv.includes("--write")) {
  writeFileSync(GOLDEN_PATH, JSON.stringify(computeBoundary(), null, 2) + "\n")
  console.log(`wrote ${GOLDEN_PATH}`)
}
