/**
 * OVL-S5 acceptance fixture — the Day Inspector's pure layer.
 *
 *   npx tsx scripts/verify-labor-inspector.ts
 *
 * Pure functions, no DB and no network. Every case below is a rule someone could
 * plausibly "simplify" away, and each one costs real diagnostic power if it goes:
 *
 *   1. THE TWO REAL BUG-10 CARDS, at their measured times — Las Brisas, Aug 19
 *      2026, in 2:55p and 3:27p store-local, still open in Froot because Square
 *      closed them at ≈9:55p, 26 minutes after that day's final sync. Both raise
 *      OPEN-STALE and both are LABELLED with their own date.
 *   2. A 30-DAY-OLD OPEN CARD STILL APPEARS (S5-A1). This is the case a lower
 *      bound on the open read would silently lose, and losing it would recreate
 *      BUG-10's cliff inside the page built to find BUG-10.
 *   3. Duncan's DOUBLE — two overlapping cards for one person, both drawn.
 *   4. Emmalea UNMAPPED — no StaffMember row, so "Unnamed", flagged, never dropped
 *      (S4's D6 posture). Had unresolvable members been filtered, half of BUG-10's
 *      finding would have been invisible.
 *   5. A midnight-spanning card appears on BOTH days, clipped, with continuesAfter
 *      on the first and continuesBefore + a date label on the second.
 *   6. A no-schedule store suppresses NO-SHOW and UNSCHEDULED entirely — seam (c)
 *      honesty. Eight of eighteen live locations are in that state.
 *   7. NO-SHOW / UNSCHEDULED at the 15-minute attendance boundary, in both
 *      directions, and an UNASSIGNED shift never raises NO-SHOW.
 *   8. S5-A2 — timecard staleness suppresses OPEN-LONG and does NOT suppress
 *      OPEN-STALE, and OPEN-LONG measures against the SYNC, not against `now`.
 *   9. S5-A9 — the OPEN-LONG boundary is 10 hours, and a prior-day open card is
 *      OPEN-STALE rather than also OPEN-LONG.
 *  10. The payload is structurally free of any wage / rate / tip / note field and
 *      of the Square team-member id — asserted on the real result object, not by
 *      reading the select list.
 *  11. A DST day gets 25 hour ticks (fall back) and 23 (spring forward), because a
 *      24-tick assumption would misplace every bar on those two days a year.
 *  12. S5-A10 — the per-person total is paidMinutesOf (breaks deducted), NOT the
 *      wall-clock length of the bars.
 *  13. S5-A12 — NO-SHOW's EVALUATION HORIZON, including the exact staging
 *      false-positive that produced it: UNR, Friday 2026-08-21, read at 07:17
 *      Pacific with timecards last synced ≈22:15 the previous evening, where
 *      three not-yet-started shifts were flagged as no-shows. A shift is eligible
 *      only once min(now, lastTimecardSyncOkAt) has passed its start plus grace;
 *      ineligible shifts are neither flagged nor counted, and the page says how
 *      many are waiting. UNSCHEDULED is deliberately NOT gated the same way.
 *
 * The Aug-19 times and durations are from docs/ROADMAP.yaml's BUG-10 row
 * ("MEASURED RESOLUTION 2026-08-20, Square dashboard, Aug 19, Las Brisas").
 */
import {
  assembleDayInspector,
  durationFlagsSuppressed,
  scheduleComparable,
  noShowEligible,
  DEFAULT_INSPECTOR_THRESHOLDS,
  OPEN_LONG_HOURS,
  SHOWED_UP_MIN_OVERLAP_MINUTES,
  DOUBLE_MIN_OVERLAP_MINUTES,
  NO_SHOW_GRACE_MINUTES,
  type FlagCode,
  type InspectorShiftRow,
  type InspectorTimecardRow,
} from "../src/lib/labor-inspector"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

// Las Brisas' zone, the one every BUG-10 measurement was taken in (-07:00 in
// August). Timecard instants are written with a real offset rather than Z, the
// way Square sends them and the way the rows are stored.
const TZ = "America/Los_Angeles"

const DUNCAN = "TMduncan"
const EMMALEA = "TMemmalea"

const NAMES = new Map<string, string>([[DUNCAN, "Duncan Ornelas"]])

function card(o: Partial<InspectorTimecardRow> = {}): InspectorTimecardRow {
  return {
    squareTeamMemberId: DUNCAN,
    startAt: new Date("2026-08-19T15:27:00-07:00"),
    endAt: null,
    status: "OPEN",
    breakPaidMinutes: 0,
    breakUnpaidMinutes: 0,
    wageJobId: "JOBteam",
    wageTitle: "Team Member",
    ...o,
  }
}

function shift(o: Partial<InspectorShiftRow> = {}): InspectorShiftRow {
  return {
    effectiveTeamMemberId: DUNCAN,
    effectiveStartAt: new Date("2026-08-19T09:00:00-07:00"),
    effectiveEndAt: new Date("2026-08-19T17:00:00-07:00"),
    effectiveJobId: "JOBteam",
    effectiveSource: "published",
    effectiveIsDeleted: false,
    ...o,
  }
}

/// Defaults chosen so a case that does not care about a knob does not have to
/// mention it: schedule comparable, sync fresh, and a sync stamp at `now`.
function run(o: {
  timecards?: InspectorTimecardRow[]
  shifts?: InspectorShiftRow[]
  names?: Map<string, string>
  date?: string
  now?: Date
  hasSchedule?: boolean
  timecardSyncOkAt?: Date | null
  durationSuppressed?: boolean
}) {
  const now = o.now ?? new Date("2026-08-19T22:30:00-07:00")
  return assembleDayInspector({
    timecards: o.timecards ?? [],
    shifts: o.shifts ?? [],
    namesBySquareId: o.names ?? NAMES,
    date: o.date ?? "2026-08-19",
    timeZone: TZ,
    now,
    hasSchedule: o.hasSchedule ?? true,
    timecardSyncOkAt: o.timecardSyncOkAt === undefined ? now : o.timecardSyncOkAt,
    durationSuppressed: o.durationSuppressed ?? false,
    thresholds: DEFAULT_INSPECTOR_THRESHOLDS,
  })
}

const personBy = (r: ReturnType<typeof run>, name: string) => r.people.find((p) => p.name === name)
const has = (flags: FlagCode[], f: FlagCode) => flags.includes(f)

// ── 1. THE TWO REAL BUG-10 CARDS ─────────────────────────────────────────────
console.log("\n1. The two real BUG-10 cards (Las Brisas, Aug 19 2026)")
{
  // Read on Aug 20 — the day after, which is when the phantom was first seen.
  const now = new Date("2026-08-20T11:00:00-07:00")
  const r = run({
    timecards: [
      card({ squareTeamMemberId: DUNCAN, startAt: new Date("2026-08-19T15:27:00-07:00") }),
      card({ squareTeamMemberId: EMMALEA, startAt: new Date("2026-08-19T14:55:00-07:00") }),
    ],
    date: "2026-08-19",
    now,
    hasSchedule: false,
  })
  check("two people on the day", r.people.length, 2)
  check("OPEN-STALE count", r.counts["OPEN-STALE"], 2)
  const duncan = personBy(r, "Duncan Ornelas")!
  const emmalea = personBy(r, "Unnamed")!
  check("Duncan flagged OPEN-STALE", has(duncan.flags, "OPEN-STALE"), true)
  check("Duncan's card labelled with its own date", duncan.bars[0].startedOn, null) // viewed ON Aug 19
  check("Duncan's clock-in label", duncan.bars[0].startLabel, "3:27p")
  check("Emmalea's clock-in label", emmalea.bars[0].startLabel, "2:55p")
  check("both still open", duncan.bars[0].open && emmalea.bars[0].open, true)

  // Viewed on Aug 20 the SAME cards must carry their date, which is the qualifier
  // BUG-10 asked for: "on the floor now" and "started yesterday" look identical
  // without it.
  const next = run({
    timecards: [card({ squareTeamMemberId: DUNCAN, startAt: new Date("2026-08-19T15:27:00-07:00") })],
    date: "2026-08-20",
    now,
    hasSchedule: false,
  })
  check("viewed a day later, the card is date-labelled", personBy(next, "Duncan Ornelas")!.bars[0].startedOn, "Aug 19")
  check("still OPEN-STALE a day later", next.counts["OPEN-STALE"], 1)
}

// ── 2. A 30-DAY-OLD OPEN CARD STILL APPEARS (S5-A1) ──────────────────────────
console.log("\n2. A 30-day-old open card is still reachable (S5-A1)")
{
  const now = new Date("2026-09-18T11:00:00-07:00")
  const r = run({
    timecards: [card({ startAt: new Date("2026-08-19T15:27:00-07:00") })],
    date: "2026-09-18",
    now,
    hasSchedule: false,
  })
  check("still rendered after 30 days", r.people.length, 1)
  check("still OPEN-STALE", r.counts["OPEN-STALE"], 1)
  check("labelled with its real date", personBy(r, "Duncan Ornelas")!.bars[0].startedOn, "Aug 19")
  check("clipped at the day's left edge", personBy(r, "Duncan Ornelas")!.bars[0].continuesBefore, true)
}

// ── 3. THE DUNCAN DOUBLE ─────────────────────────────────────────────────────
console.log("\n3. Two overlapping cards for one person raise DOUBLE")
{
  const r = run({
    timecards: [
      card({ startAt: new Date("2026-08-19T09:00:00-07:00"), endAt: new Date("2026-08-19T15:00:00-07:00") }),
      card({ startAt: new Date("2026-08-19T14:00:00-07:00"), endAt: new Date("2026-08-19T18:00:00-07:00") }),
    ],
    hasSchedule: false,
  })
  const p = personBy(r, "Duncan Ornelas")!
  check("one person, two bars", p.bars.length, 2)
  check("person flagged DOUBLE", has(p.flags, "DOUBLE"), true)
  check("both bars flagged DOUBLE", p.bars.every((b) => has(b.flags, "DOUBLE")), true)
  check("DOUBLE counted once per person", r.counts.DOUBLE, 1)

  // Back-to-back cards TOUCH and must not fire — a clean job transfer is not a
  // double punch.
  const touching = run({
    timecards: [
      card({ startAt: new Date("2026-08-19T09:00:00-07:00"), endAt: new Date("2026-08-19T13:00:00-07:00") }),
      card({ startAt: new Date("2026-08-19T13:00:00-07:00"), endAt: new Date("2026-08-19T17:00:00-07:00") }),
    ],
    hasSchedule: false,
  })
  check("back-to-back cards are not a DOUBLE", touching.counts.DOUBLE, 0)

  // …and a sub-threshold overlap is a recording artifact, not the Duncan pattern.
  const graze = run({
    timecards: [
      card({ startAt: new Date("2026-08-19T09:00:00-07:00"), endAt: new Date("2026-08-19T13:00:30-07:00") }),
      card({ startAt: new Date("2026-08-19T13:00:00-07:00"), endAt: new Date("2026-08-19T17:00:00-07:00") }),
    ],
    hasSchedule: false,
  })
  check(`a ${DOUBLE_MIN_OVERLAP_MINUTES}-minute floor drops a 30s overlap`, graze.counts.DOUBLE, 0)
}

// ── 4. EMMALEA UNMAPPED ──────────────────────────────────────────────────────
console.log("\n4. An unmapped member is Unnamed, flagged, and never dropped")
{
  const r = run({
    timecards: [
      card({ squareTeamMemberId: DUNCAN, endAt: new Date("2026-08-19T21:55:00-07:00") }),
      card({ squareTeamMemberId: EMMALEA, endAt: new Date("2026-08-19T21:55:00-07:00") }),
    ],
    hasSchedule: false,
  })
  check("both people present", r.people.length, 2)
  const unnamed = personBy(r, "Unnamed")!
  check("rendered as Unnamed", unnamed.name, "Unnamed")
  check("flagged UNMAPPED", has(unnamed.flags, "UNMAPPED"), true)
  check("UNMAPPED counted", r.counts.UNMAPPED, 1)
  check("Unnamed sorts last", r.people[r.people.length - 1].name, "Unnamed")

  // A blank displayName is the same state as no row at all.
  const blank = run({
    timecards: [card({ squareTeamMemberId: EMMALEA })],
    names: new Map([[EMMALEA, "   "]]),
    hasSchedule: false,
  })
  check("a blank displayName is also UNMAPPED", blank.counts.UNMAPPED, 1)
}

// ── 5. A MIDNIGHT-SPANNING CARD ──────────────────────────────────────────────
console.log("\n5. A midnight-spanning card appears on both days, clipped")
{
  const tc = card({
    startAt: new Date("2026-08-19T22:00:00-07:00"),
    endAt: new Date("2026-08-20T02:00:00-07:00"),
  })
  const now = new Date("2026-08-21T09:00:00-07:00")

  const d1 = run({ timecards: [tc], date: "2026-08-19", now, hasSchedule: false })
  const b1 = personBy(d1, "Duncan Ornelas")!.bars[0]
  check("day 1 — present", d1.people.length, 1)
  check("day 1 — no date label (it started here)", b1.startedOn, null)
  check("day 1 — continues after midnight", b1.continuesAfter, true)
  check("day 1 — not clipped on the left", b1.continuesBefore, false)
  check("day 1 — ends at the day's edge", Math.round(b1.endPct), 100)

  const d2 = run({ timecards: [tc], date: "2026-08-20", now, hasSchedule: false })
  const b2 = personBy(d2, "Duncan Ornelas")!.bars[0]
  check("day 2 — present as well", d2.people.length, 1)
  check("day 2 — carries its start date", b2.startedOn, "Aug 19")
  check("day 2 — clipped on the left", b2.continuesBefore, true)
  check("day 2 — starts at the day's edge", Math.round(b2.startPct), 0)
  check("day 2 — ends two hours in", Math.round(b2.endPct), Math.round((2 / 24) * 100))
}

// ── 6. A NO-SCHEDULE STORE SUPPRESSES BOTH SCHEDULE FLAGS ────────────────────
console.log("\n6. A store with no schedule data suppresses NO-SHOW and UNSCHEDULED")
{
  const r = run({
    timecards: [card({ startAt: new Date("2026-08-19T09:00:00-07:00"), endAt: new Date("2026-08-19T17:00:00-07:00") })],
    shifts: [],
    hasSchedule: false,
  })
  check("no UNSCHEDULED raised", r.counts.UNSCHEDULED, 0)
  check("no NO-SHOW raised", r.counts["NO-SHOW"], 0)
  check("the page is told to say so", r.scheduleSuppressed, true)

  // The predicate itself — the two states that mean "we have no plan", plus the
  // healthy-but-empty day.
  check("never ⇒ not comparable", scheduleComparable("never", 0), false)
  check("synced-empty ⇒ not comparable", scheduleComparable("synced-empty", 0), false)
  check("fresh with zero shifts ⇒ not comparable", scheduleComparable("fresh", 0), false)
  check("fresh with shifts ⇒ comparable", scheduleComparable("fresh", 3), true)
  check("STALE with shifts is still comparable", scheduleComparable("stale", 3), true)
  check("ERROR with shifts is still comparable", scheduleComparable("error", 3), true)
}

// ── 7. THE ATTENDANCE BOUNDARY ───────────────────────────────────────────────
console.log(`\n7. NO-SHOW / UNSCHEDULED at the ${SHOWED_UP_MIN_OVERLAP_MINUTES}-minute boundary`)
{
  // 14 minutes of overlap is coincidence: the shift is a NO-SHOW and the card is
  // UNSCHEDULED, both at once, which is the honest reading.
  const under = run({
    timecards: [card({ startAt: new Date("2026-08-19T16:46:00-07:00"), endAt: new Date("2026-08-19T19:00:00-07:00") })],
    shifts: [shift()],
  })
  check("14 min ⇒ NO-SHOW", under.counts["NO-SHOW"], 1)
  check("14 min ⇒ UNSCHEDULED", under.counts.UNSCHEDULED, 1)

  // 16 minutes reads as attendance and neither flag fires.
  const over = run({
    timecards: [card({ startAt: new Date("2026-08-19T16:44:00-07:00"), endAt: new Date("2026-08-19T19:00:00-07:00") })],
    shifts: [shift()],
  })
  check("16 min ⇒ no NO-SHOW", over.counts["NO-SHOW"], 0)
  check("16 min ⇒ no UNSCHEDULED", over.counts.UNSCHEDULED, 0)

  // A tombstoned shift is not scheduled labour — asserted on the ROW, so the rule
  // is provable without a database (OVL-S4's ratified redundancy).
  const deleted = run({
    timecards: [card({ startAt: new Date("2026-08-19T09:00:00-07:00"), endAt: new Date("2026-08-19T17:00:00-07:00") })],
    shifts: [shift({ effectiveIsDeleted: true })],
  })
  check("a tombstoned shift raises no NO-SHOW", deleted.counts["NO-SHOW"], 0)

  // An UNASSIGNED shift can never be a no-show — there is nobody to fail to show —
  // but it must still be drawn, or the plan is understated.
  const openShift = run({ shifts: [shift({ effectiveTeamMemberId: null })] })
  check("an unassigned shift raises no NO-SHOW", openShift.counts["NO-SHOW"], 0)
  check("but it is still rendered", personBy(openShift, "Unassigned shifts")?.ghosts.length, 1)
  check("with no paid total", personBy(openShift, "Unassigned shifts")?.paidLabel, null)
}

// ── 8. S5-A2 — STALENESS GATES DURATION FLAGS, NOT DATE FLAGS ────────────────
console.log("\n8. Timecard staleness suppresses OPEN-LONG and never OPEN-STALE (S5-A2)")
{
  // A card opened today, 14 hours ago, on a store whose sync went stale.
  const now = new Date("2026-08-19T23:00:00-07:00")
  const fourteenHoursAgo = new Date("2026-08-19T09:00:00-07:00")

  const stale = run({
    timecards: [card({ startAt: fourteenHoursAgo })],
    now,
    hasSchedule: false,
    durationSuppressed: true,
    timecardSyncOkAt: new Date("2026-08-18T09:00:00-07:00"),
  })
  check("stale ⇒ zero OPEN-LONG", stale.counts["OPEN-LONG"], 0)
  check("stale ⇒ the page is told to say so", stale.durationSuppressed, true)

  const fresh = run({ timecards: [card({ startAt: fourteenHoursAgo })], now, hasSchedule: false })
  check("fresh ⇒ the same card IS OPEN-LONG", fresh.counts["OPEN-LONG"], 1)

  // OPEN-STALE is a DATE comparison and survives staleness — it is the one flag
  // that matters most on a store whose sync is broken.
  const staleAndPriorDay = run({
    timecards: [card({ startAt: new Date("2026-08-18T15:27:00-07:00") })],
    now,
    hasSchedule: false,
    durationSuppressed: true,
    timecardSyncOkAt: new Date("2026-08-18T09:00:00-07:00"),
  })
  check("stale ⇒ OPEN-STALE still raised", staleAndPriorDay.counts["OPEN-STALE"], 1)

  // OPEN-LONG MEASURES AGAINST THE SYNC, NOT AGAINST `now`. Same card, same clock;
  // only the sync stamp moves, and it must move the answer.
  const syncBehind = run({
    timecards: [card({ startAt: fourteenHoursAgo })],
    now,
    hasSchedule: false,
    timecardSyncOkAt: new Date("2026-08-19T17:00:00-07:00"), // 8h after clock-in
  })
  check("a sync 8h after clock-in ⇒ no OPEN-LONG", syncBehind.counts["OPEN-LONG"], 0)

  // Never synced at all ⇒ no duration can be claimed.
  const neverSynced = run({
    timecards: [card({ startAt: fourteenHoursAgo })],
    now,
    hasSchedule: false,
    timecardSyncOkAt: null,
  })
  check("never synced ⇒ no OPEN-LONG", neverSynced.counts["OPEN-LONG"], 0)

  check("durationFlagsSuppressed(fresh)", durationFlagsSuppressed("fresh"), false)
  check("durationFlagsSuppressed(stale)", durationFlagsSuppressed("stale"), true)
  check("durationFlagsSuppressed(error)", durationFlagsSuppressed("error"), true)
  check("durationFlagsSuppressed(never)", durationFlagsSuppressed("never"), true)
}

// ── 9. S5-A9 — THE 10-HOUR BOUNDARY ──────────────────────────────────────────
console.log(`\n9. OPEN_LONG_HOURS is ${OPEN_LONG_HOURS} (S5-A9)`)
{
  check("the constant", OPEN_LONG_HOURS, 10)
  const now = new Date("2026-08-19T20:00:00-07:00")

  // 9h59 open — under.
  const under = run({
    timecards: [card({ startAt: new Date("2026-08-19T10:01:00-07:00") })],
    now,
    hasSchedule: false,
  })
  check("9h59 ⇒ no OPEN-LONG", under.counts["OPEN-LONG"], 0)

  // Exactly 10h — the boundary is inclusive.
  const at = run({
    timecards: [card({ startAt: new Date("2026-08-19T10:00:00-07:00") })],
    now,
    hasSchedule: false,
  })
  check("exactly 10h ⇒ OPEN-LONG", at.counts["OPEN-LONG"], 1)

  // A PRIOR-DAY open card is OPEN-STALE and NOT also OPEN-LONG: the stale
  // statement is the stronger and more specific one, and two chips saying the same
  // thing would train the reader to skim both.
  const priorDay = run({
    timecards: [card({ startAt: new Date("2026-08-18T02:00:00-07:00") })],
    now,
    date: "2026-08-19",
    hasSchedule: false,
  })
  check("prior-day open ⇒ OPEN-STALE", priorDay.counts["OPEN-STALE"], 1)
  check("prior-day open ⇒ NOT also OPEN-LONG", priorDay.counts["OPEN-LONG"], 0)
}

// ── 10. THE PAYLOAD IS STRUCTURALLY CLEAN ────────────────────────────────────
console.log("\n10. No wage / rate / tip / note field, and no Square team-member id")
{
  const r = run({
    timecards: [
      card({ squareTeamMemberId: DUNCAN, endAt: new Date("2026-08-19T21:55:00-07:00"), breakUnpaidMinutes: 30 }),
      card({ squareTeamMemberId: EMMALEA }),
    ],
    shifts: [shift(), shift({ effectiveTeamMemberId: null })],
  })
  const json = JSON.stringify(r)
  const keys = new Set<string>()
  JSON.parse(json, function (k) {
    if (k) keys.add(k)
    return undefined
  })
  for (const forbidden of ["wageHourlyRate", "wageTipEligible", "declaredCashTips", "hourlyRate", "annualRate", "notes", "draftNotes", "publishedNotes", "squareTeamMemberId"]) {
    check(`no \`${forbidden}\` key anywhere`, keys.has(forbidden), false)
  }
  check("no Square team-member id in the serialized body", json.includes(DUNCAN) || json.includes(EMMALEA), false)
  check("person keys are opaque", r.people[0].key, "p0")
  // The word "rate" must not appear at all — a stray label would be the first step
  // back toward putting money on a manager-tier person view.
  check("the body says nothing about a rate", /"[^"]*[Rr]ate[^"]*":/.test(json), false)
}

// ── 11. DST DAYS ─────────────────────────────────────────────────────────────
console.log("\n11. DST days get 23 and 25 hour ticks, not 24")
{
  const fallBack = run({ date: "2026-11-01", now: new Date("2026-11-02T09:00:00-08:00"), hasSchedule: false })
  check("fall back ⇒ 25 ticks", fallBack.hourTicks.length, 25)
  const springForward = run({ date: "2026-03-08", now: new Date("2026-03-09T09:00:00-07:00"), hasSchedule: false })
  check("spring forward ⇒ 23 ticks", springForward.hourTicks.length, 23)
  const ordinary = run({ hasSchedule: false })
  check("an ordinary day ⇒ 24 ticks", ordinary.hourTicks.length, 24)
  check("the axis starts at midnight", ordinary.hourTicks[0].label, "12a")
}

// ── 12. S5-A10 — THE TOTAL IS PAID TIME, NOT BAR LENGTH ──────────────────────
console.log("\n12. The per-person total is paidMinutesOf, breaks deducted (S5-A10)")
{
  // 09:00 → 17:00 is eight hours of bar, with a 30-minute unpaid break inside it.
  const r = run({
    timecards: [
      card({
        startAt: new Date("2026-08-19T09:00:00-07:00"),
        endAt: new Date("2026-08-19T17:00:00-07:00"),
        breakUnpaidMinutes: 30,
        breakPaidMinutes: 10,
        status: "CLOSED",
      }),
    ],
    hasSchedule: false,
  })
  const p = personBy(r, "Duncan Ornelas")!
  check("the total deducts the unpaid break", p.paidLabel, "7.5h paid")
  check("it is NOT the 8h bar length", p.paidLabel === "8.0h paid", false)
  check("the bar still spans the whole clock-in to clock-out", Math.round(p.bars[0].endPct - p.bars[0].startPct), Math.round((8 / 24) * 100))
  check("the paid break is named, not deducted", p.bars[0].detail.includes("10m paid break"), true)
  check("the unpaid break is named too", p.bars[0].detail.includes("30m unpaid break"), true)

  // S5-A6 — the count is CARDS ON THE FLOOR, and a person with two cards
  // contributes two.
  const two = run({
    timecards: [
      card({ startAt: new Date("2026-08-19T09:00:00-07:00"), endAt: new Date("2026-08-19T12:00:00-07:00") }),
      card({ startAt: new Date("2026-08-19T13:00:00-07:00"), endAt: new Date("2026-08-19T17:00:00-07:00") }),
    ],
    hasSchedule: false,
  })
  check("cardsOnFloor counts cards, not people", two.cardsOnFloor, 2)
  check("…while people is one", two.people.length, 1)
}


// ── 13. S5-A12 — THE NO-SHOW EVALUATION HORIZON ──────────────────────────────
console.log(`\n13. NO-SHOW's evaluation horizon, grace ${NO_SHOW_GRACE_MINUTES}m (S5-A12)`)
{
  check("the constant", NO_SHOW_GRACE_MINUTES, 20)

  const eightAm = new Date("2026-08-21T08:00:00-07:00")
  const morningShift = shift({
    effectiveStartAt: eightAm,
    effectiveEndAt: new Date("2026-08-21T16:00:00-07:00"),
  })

  // (a) The shift has not started yet. Read at 7:17a with a sync minutes old —
  // the sync is FRESH and it still must not fire, because 8a has not happened.
  const beforeStart = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T07:17:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-21T07:00:00-07:00"),
  })
  check("shift at 8a, viewed 7:17a, fresh sync ⇒ no NO-SHOW", beforeStart.counts["NO-SHOW"], 0)
  check("…and it is counted as pending instead", beforeStart.noShowPendingCount, 1)
  check("…and the ghost carries no flag", beforeStart.people[0].ghosts[0].flags.length, 0)

  // (b) THE OBSERVED UNR CASE. Read at 3p, well after the 8a shift — but the sync
  // stopped at 10:15p the PREVIOUS evening, so Froot cannot know whether anyone
  // clocked in. This is the one a `now`-only fix would still have got wrong.
  const unr = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T15:00:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-20T22:15:00-07:00"),
  })
  check("shift at 8a, viewed 3p, sync 10:15p PRIOR day ⇒ no NO-SHOW", unr.counts["NO-SHOW"], 0)
  check("…counted as pending", unr.noShowPendingCount, 1)
  check("…and the horizon is named in store-local time", unr.noShowHorizonLabel, "10:15p Aug 20")

  // (c) The sync HAS reached past the shift, and nobody clocked in. Now it fires.
  const real = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T15:00:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-21T14:50:00-07:00"),
  })
  check("shift at 8a, viewed 3p, sync 2:50p, no card ⇒ NO-SHOW", real.counts["NO-SHOW"], 1)
  check("…nothing left pending", real.noShowPendingCount, 0)

  // (d) THE GRACE BOUNDARY, driven by the horizon rather than by the clock.
  const at19 = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T15:00:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-21T08:19:00-07:00"),
  })
  check("horizon at start+19m ⇒ no NO-SHOW", at19.counts["NO-SHOW"], 0)
  const at21 = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T15:00:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-21T08:21:00-07:00"),
  })
  check("horizon at start+21m ⇒ NO-SHOW", at21.counts["NO-SHOW"], 1)

  // The predicate on its own, at both sides of the boundary and at null.
  check(
    "noShowEligible at start+19m",
    noShowEligible(eightAm, new Date("2026-08-21T08:19:00-07:00").getTime(), NO_SHOW_GRACE_MINUTES),
    false
  )
  check(
    "noShowEligible at start+20m (inclusive)",
    noShowEligible(eightAm, new Date("2026-08-21T08:20:00-07:00").getTime(), NO_SHOW_GRACE_MINUTES),
    true
  )
  check("noShowEligible with a null horizon", noShowEligible(eightAm, null, NO_SHOW_GRACE_MINUTES), false)

  // (e) A never-synced store evaluates nothing and says so with the OTHER sentence.
  const neverSynced = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T15:00:00-07:00"),
    timecardSyncOkAt: null,
  })
  check("never synced ⇒ no NO-SHOW", neverSynced.counts["NO-SHOW"], 0)
  check("never synced ⇒ pending", neverSynced.noShowPendingCount, 1)
  check("never synced ⇒ no horizon label", neverSynced.noShowHorizonLabel, null)

  // (f) MIXED — one shift past the horizon and unattended, one still ahead of it.
  // The count must reflect only the evaluated one.
  const mixed = run({
    shifts: [
      morningShift,
      shift({
        effectiveStartAt: new Date("2026-08-21T18:00:00-07:00"),
        effectiveEndAt: new Date("2026-08-21T22:00:00-07:00"),
      }),
    ],
    date: "2026-08-21",
    now: new Date("2026-08-21T15:00:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-21T14:50:00-07:00"),
  })
  check("mixed — one evaluated NO-SHOW", mixed.counts["NO-SHOW"], 1)
  check("mixed — one still pending", mixed.noShowPendingCount, 1)
  check("mixed — the pending ghost is unflagged", mixed.people[0].ghosts[1].flags.length, 0)

  // (g) A SUPPRESSED SCHEDULE PRODUCES ONE SENTENCE, NOT TWO. Where there is no
  // plan to compare against, nothing is "pending" either — the reader gets the
  // schedule-suppressed message alone.
  const suppressed = run({
    shifts: [morningShift],
    date: "2026-08-21",
    now: new Date("2026-08-21T07:17:00-07:00"),
    hasSchedule: false,
  })
  check("schedule suppressed ⇒ nothing counted pending", suppressed.noShowPendingCount, 0)
  check("schedule suppressed ⇒ its own flag is set", suppressed.scheduleSuppressed, true)

  // (h) UNSCHEDULED IS NOT GATED BY THE HORIZON. A card exists — we are looking at
  // it — so the finding is evidence-positive and stands however far behind the
  // sync is. Gating it would suppress a TRUE finding for no reason.
  const unscheduledBehindHorizon = run({
    timecards: [
      card({ startAt: new Date("2026-08-21T09:00:00-07:00"), endAt: new Date("2026-08-21T17:00:00-07:00") }),
    ],
    shifts: [],
    date: "2026-08-21",
    now: new Date("2026-08-21T18:00:00-07:00"),
    timecardSyncOkAt: new Date("2026-08-20T22:15:00-07:00"),
    hasSchedule: true,
  })
  check("UNSCHEDULED still fires behind the horizon", unscheduledBehindHorizon.counts.UNSCHEDULED, 1)
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`)
process.exit(failures === 0 ? 0 : 1)
