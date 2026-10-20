/**
 * MS-2 F12 — THE SEEDED DATA the inspector-unchanged proof runs on.
 *
 * Gary approved F12 (2026-10-16) "on condition that the fixture proves the
 * inspector's output is identical before and after the move, on the same seeded
 * data". This file IS that same seeded data. It is consumed twice:
 *
 *   1. BEFORE the move — `npx tsx scripts/ms2-inspector-seed.ts --write` was run
 *      against the UNMODIFIED src/lib/labor-inspector.ts (HEAD 76b857c) and wrote
 *      scripts/ms2-inspector-golden.json: assembleDayInspector's full output for
 *      every scenario below, serialised.
 *   2. AFTER the move — scripts/verify-ms2.ts recomputes every scenario with the
 *      extracted predicate in place and asserts the serialised output is
 *      BYTE-IDENTICAL to the golden file.
 *
 * NEVER REGENERATE THE GOLDEN FILE FROM MODIFIED CODE — that would compare the
 * new code with itself and prove nothing. If the inspector's behaviour is
 * deliberately changed by a later ruling, regenerate it in that session from the
 * pre-change commit and say so in the commit message.
 *
 * The scenarios lean on PAIRING, because pairing is the only thing that moved:
 * the 15-minute overlap boundary both ways, the 20-minute no-show grace boundary
 * both ways, the sync horizon, several shifts a day, a card spanning two shifts,
 * midnight, open cards, unassigned / deleted / draft shifts, and two members.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  assembleDayInspector,
  DEFAULT_INSPECTOR_THRESHOLDS,
  type InspectorShiftRow,
  type InspectorTimecardRow,
} from "../src/lib/labor-inspector"

const TZ = "America/Los_Angeles"
const A = "TMseedA"
const B = "TMseedB"
const NAMES = new Map<string, string>([
  [A, "MS-2 Seed Alpha"],
  [B, "MS-2 Seed Bravo"],
])

const t = (hhmm: string, day = "2026-09-10") => new Date(`${day}T${hhmm}:00-07:00`)

function card(member: string, start: Date, end: Date | null): InspectorTimecardRow {
  return {
    squareTeamMemberId: member,
    startAt: start,
    endAt: end,
    status: end ? "CLOSED" : "OPEN",
    breakPaidMinutes: 0,
    breakUnpaidMinutes: 0,
    wageJobId: "JOBseed",
    wageTitle: "Team Member",
  }
}

function shift(member: string | null, start: Date, end: Date, o: Partial<InspectorShiftRow> = {}): InspectorShiftRow {
  return {
    effectiveTeamMemberId: member,
    effectiveStartAt: start,
    effectiveEndAt: end,
    effectiveJobId: "JOBseed",
    effectiveSource: "published",
    effectiveIsDeleted: false,
    ...o,
  }
}

type Scenario = {
  name: string
  timecards: InspectorTimecardRow[]
  shifts: InspectorShiftRow[]
  date?: string
  now?: Date
  syncOk?: Date | null
  hasSchedule?: boolean
}

export const SCENARIOS: Scenario[] = [
  {
    name: "overlap exactly 15 min pairs; 14 min does not",
    timecards: [card(A, t("16:45"), t("18:00")), card(B, t("16:46"), t("18:00"))],
    shifts: [shift(A, t("09:00"), t("17:00")), shift(B, t("09:00"), t("17:00"))],
  },
  {
    name: "no-show grace boundary: start+20 at horizon vs one minute short",
    timecards: [],
    shifts: [shift(A, t("12:00"), t("16:00")), shift(B, t("12:01"), t("16:00"))],
    now: t("20:00"),
    syncOk: t("12:20"),
  },
  {
    name: "never-synced store: no no-show at all",
    timecards: [],
    shifts: [shift(A, t("09:00"), t("17:00"))],
    syncOk: null,
  },
  {
    name: "late clock-in still pairs; early clock-in pairs",
    timecards: [card(A, t("09:40"), t("17:00")), card(B, t("08:30"), t("17:00"))],
    shifts: [shift(A, t("09:00"), t("17:00")), shift(B, t("09:00"), t("17:00"))],
  },
  {
    name: "split shift covered by one card; second split uncovered for B",
    timecards: [card(A, t("09:00"), t("17:00")), card(B, t("09:00"), t("12:50"))],
    shifts: [
      shift(A, t("09:00"), t("13:00")),
      shift(A, t("13:00"), t("17:00")),
      shift(B, t("09:00"), t("13:00")),
      shift(B, t("13:00"), t("17:00")),
    ],
  },
  {
    name: "unscheduled card beside a scheduled one; double punch",
    timecards: [
      card(A, t("09:00"), t("13:00")),
      card(A, t("12:00"), t("14:00")),
      card(A, t("18:00"), t("20:00")),
    ],
    shifts: [shift(A, t("09:00"), t("13:00"))],
  },
  {
    name: "open card today pairs against the ceiling",
    timecards: [card(A, t("09:05"), null)],
    shifts: [shift(A, t("09:00"), t("17:00"))],
    now: t("11:00"),
    syncOk: t("10:55"),
  },
  {
    name: "midnight-crossing shift and card, viewed on the first day",
    timecards: [card(A, t("22:10"), t("02:00", "2026-09-11"))],
    shifts: [shift(A, t("22:00"), t("02:00", "2026-09-11"))],
    now: t("12:00", "2026-09-11"),
    syncOk: t("12:00", "2026-09-11"),
  },
  {
    name: "midnight-crossing, viewed on the second day",
    timecards: [card(A, t("22:10"), t("02:00", "2026-09-11"))],
    shifts: [shift(A, t("22:00"), t("02:00", "2026-09-11"))],
    date: "2026-09-11",
    now: t("12:00", "2026-09-11"),
    syncOk: t("12:00", "2026-09-11"),
  },
  {
    name: "unassigned, deleted and draft shifts",
    timecards: [card(A, t("09:00"), t("17:00"))],
    shifts: [
      shift(null, t("09:00"), t("17:00")),
      shift(A, t("09:00"), t("17:00"), { effectiveIsDeleted: true }),
      shift(B, t("10:00"), t("14:00"), { effectiveSource: "draft" }),
    ],
  },
  {
    name: "schedule not comparable: nothing paired",
    timecards: [card(A, t("09:00"), t("17:00"))],
    shifts: [shift(B, t("09:00"), t("17:00"))],
    hasSchedule: false,
  },
]

export function runScenario(s: Scenario) {
  const date = s.date ?? "2026-09-10"
  const now = s.now ?? t("23:30")
  return assembleDayInspector({
    timecards: s.timecards,
    shifts: s.shifts,
    namesBySquareId: NAMES,
    date,
    timeZone: TZ,
    now,
    hasSchedule: s.hasSchedule ?? true,
    timecardSyncOkAt: s.syncOk === undefined ? now : s.syncOk,
    durationSuppressed: false,
    thresholds: DEFAULT_INSPECTOR_THRESHOLDS,
  })
}

export const GOLDEN_PATH = join(__dirname, "ms2-inspector-golden.json")

export function serialiseAll(): string {
  return JSON.stringify(
    SCENARIOS.map((s) => ({ name: s.name, result: runScenario(s) })),
    null,
    2
  )
}

if (process.argv.includes("--write")) {
  writeFileSync(GOLDEN_PATH, serialiseAll() + "\n")
  console.log(`wrote ${GOLDEN_PATH} (${SCENARIOS.length} scenarios)`)
}
