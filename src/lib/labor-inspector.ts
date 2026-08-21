import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import {
  clockedEndMs,
  computeHealth,
  paidMinutesOf,
  DEFAULT_STALE_AFTER_MINUTES,
  type LaborHealth,
} from "@/lib/labor-actuals"
import {
  addDaysStr,
  formatClockInLabel,
  getOverlayJobs,
  getScheduleSyncSummary,
  localHourOf,
  localMidnightUtc,
  UNKNOWN_JOB_ID,
  type OverlayJob,
  type ScheduleSyncSummary,
} from "@/lib/labor-schedule"

// OVL-S5 — THE LABOR DAY INSPECTOR. A troubleshooting surface, not a card.
//
// Design record: docs/prompts/Labor_S5_Day_Inspector_Session_Prompt.md.
// Rulings: docs/DECISIONS.md § "Labor Day Inspector, S5 scope" (2026-08-21).
// The case that earned it: BUG-10 — two Las Brisas timecards opened 2026-08-19
// (2:55p and 3:27p store-local) that Square closed at ≈9:55p, 26 minutes after
// that day's final dashboard-triggered sync, and which are therefore frozen open
// in Froot forever. Finding that took a Neon session. THIS PAGE EXISTS SO THAT
// HUNT NEVER NEEDS A DATABASE AGAIN.
//
// THIS MODULE SITS ON THE labor-actuals / labor-schedule SIDE OF THE IMPORT WALL
// — L-2 seam (b). labor-plan.ts, labor-coverage.ts, labor-budget.ts,
// labor-forecast.ts, labor-daily.ts and labor-week.ts never import it and gain no
// Square-sourced input. THE BOUNDARY TEST is unchanged: drop the Square labor
// tables and every existing labor surface must render BYTE-IDENTICALLY.
//
// READ-ONLY IN EVERY DIRECTION (Gary, 2026-08-21). No Square call — mirrored rows
// only. No sync trigger: scheduleLaborRefresh (labor-dashboard.ts) is deliberately
// NOT called here, because the page's job is to REPORT staleness, not to quietly
// repair it before the reader can see it. And nothing on this page writes anything
// anywhere. Corrections happen in Square; this tells you where to look.
//
// NEVER WAGES, RATES, TIPS OR NOTES. wageHourlyRate, wageTipEligible and
// declaredCashTips sit on the very row the timecard read touches and are not in
// its select list; draftNotes and publishedNotes are not in the shift read's.
// NOT FILTERED AFTERWARDS — NOT FETCHED, the discipline every overlay read
// carries. squareTeamMemberId is read to JOIN and NEVER EMITTED (its own schema
// doc-comment: "this column NEVER leaves the server") — person.key is opaque.

// ─── THRESHOLDS (S5-A7) ───────────────────────────────────────────────────────
//
// ALL FOUR ARE NAMED, EXPORTED AND INJECTABLE, so a fixture can drive a boundary
// without editing this file and a reader can see what a flag actually means
// without reading the loop that raises it.

/// OPEN-LONG. A MISSED-CLOCK-OUT HEURISTIC AND NOTHING MORE (Gary, S5-A9).
///
/// It deliberately carries NO jurisdictional reasoning. An earlier draft grounded
/// this in California daily double-time, which would have been wrong twice over:
/// it makes the number look like a legal threshold it is not, and Froot's stores
/// are not all in one jurisdiction. Ten hours is simply longer than a shift
/// anybody at these stores actually works, so a card still open past it is far
/// more likely to be a forgotten clock-out than a person still on the floor.
///
/// It is a PROMPT TO GO LOOK, not a finding. The page cannot tell a long shift
/// from a missed punch and does not pretend to.
export const OPEN_LONG_HOURS = 10

/// DOUBLE. One minute, not zero.
///
/// The intervals are half-open, so two cards that merely TOUCH (one ends at the
/// instant the next begins — a job transfer, recorded cleanly) already overlap by
/// nothing and would not fire at zero. The minute exists for the case that does:
/// Square rounding or a same-second re-punch producing a one- or two-second
/// overlap, which is a recording artifact rather than the Duncan pattern.
export const DOUBLE_MIN_OVERLAP_MINUTES = 1

/// NO-SHOW / UNSCHEDULED. How much overlap counts as "they showed up for this".
///
/// A person scheduled 9–5 who clocks in at 9:10 obviously worked that shift. A
/// person scheduled 9–5 whose only card that day is 4:55p–5:00p did not — that is
/// five minutes of accidental overlap and treating it as attendance would hide a
/// genuine no-show. Fifteen minutes is the smallest span that reads as attendance
/// rather than coincidence. NO EXISTING CONSTANT WAS INHERITED: nothing else in
/// the estate answers this question, so it is stated here rather than borrowed
/// from something that means something else.
export const SHOWED_UP_MIN_OVERLAP_MINUTES = 15

/// NO-SHOW's GRACE (S5-A12). How long after a shift's start we wait before the
/// absence of a timecard means anything.
///
/// Twenty minutes: long enough that a few minutes' late clock-in is not called a
/// no-show, short enough that a real one surfaces while the shift can still be
/// covered. It is the SECOND half of the eligibility rule and not the whole of it
/// — see noShowEligible() — because grace alone would still have produced the
/// defect this constant arrived with.
export const NO_SHOW_GRACE_MINUTES = 20

export type InspectorThresholds = {
  openLongHours: number
  doubleMinOverlapMinutes: number
  showedUpMinOverlapMinutes: number
  noShowGraceMinutes: number
}

export const DEFAULT_INSPECTOR_THRESHOLDS: InspectorThresholds = {
  openLongHours: OPEN_LONG_HOURS,
  doubleMinOverlapMinutes: DOUBLE_MIN_OVERLAP_MINUTES,
  showedUpMinOverlapMinutes: SHOWED_UP_MIN_OVERLAP_MINUTES,
  noShowGraceMinutes: NO_SHOW_GRACE_MINUTES,
}

/// THE NO-SHOW EVALUATION HORIZON (S5-A12), and it is A2's posture applied to the
/// second absence-derived flag.
///
/// MEASURED ON STAGING 2026-08-21 07:17 Pacific (UNR, Friday Aug 21). NO-SHOW
/// fired on three shifts that HAD NOT YET STARTED — ghosts at ~8a, ~10a and ~3p,
/// read at 07:17 — on a store whose timecards had last synced ~22:15 the previous
/// evening. Two defects in one condition, and they are worth separating because
/// fixing only the obvious one would have left the other live:
///
///   (1) IT EVALUATED THE FUTURE. A 3p shift cannot be a no-show at 7:17a. On its
///       own this would be fixed by comparing against `now`.
///   (2) IT EVALUATED AGAINST `now` RATHER THAN AGAINST WHAT HAD BEEN SYNCED.
///       Froot had heard nothing since 22:15; it could not have known whether
///       anyone clocked in for the 8a shift either. A `now` comparison alone would
///       have kept flagging that one, confidently and wrongly, all morning.
///
/// So the horizon is `min(now, lastTimecardSyncOkAt)` — the same quantity A2 uses
/// for OPEN-LONG, and deliberately the SAME EXPRESSION rather than a parallel one:
/// NO FLAG DERIVED FROM DURATION OR FROM ABSENCE MAY ASSERT ANYTHING ABOUT A
/// WINDOW THE TIMECARD SYNC HAS NOT REACHED. A never-synced store yields a null
/// horizon and therefore no NO-SHOW at all, which is the correct answer rather
/// than a degenerate one.
///
/// UNSCHEDULED IS DELIBERATELY NOT GATED BY THIS. It is EVIDENCE-POSITIVE — a card
/// exists, we are looking straight at it — so it asserts something about data we
/// have rather than about data we might be missing. A horizon on it would suppress
/// a true finding for no reason.
export function noShowEligible(
  shiftStartAt: Date,
  syncedThroughMs: number | null,
  graceMinutes: number
): boolean {
  if (syncedThroughMs === null) return false
  return shiftStartAt.getTime() + graceMinutes * 60000 <= syncedThroughMs
}

/// THE SCHEDULE-SUPPRESSION CONDITION (S5-A7), exported as a predicate because it
/// is a rule and not a number.
///
/// Seam (c) honesty. Eight of eighteen live locations have nothing in Square
/// Scheduling mid-rollout, and at those stores EVERY timecard would raise
/// UNSCHEDULED — a wall of false variance that would teach the reader to ignore
/// the flag everywhere. `never` and `synced-empty` are the "we have no plan to
/// compare against" states; a HEALTHY window with zero shifts on the viewed day is
/// the same sentence for that day, so it suppresses too.
///
/// NOTE WHAT DOES NOT SUPPRESS: `stale` and `error`. Those states still HAVE a
/// plan — the last one we were told — and comparing against a labelled stale plan
/// is exactly what seam (c) asks for, rather than a blank pretending "no schedule".
export function scheduleComparable(
  scheduleHealth: ScheduleSyncSummary["health"],
  shiftsOnDay: number
): boolean {
  if (scheduleHealth === "never" || scheduleHealth === "synced-empty") return false
  return shiftsOnDay > 0
}

/// THE DURATION-FLAG SUPPRESSION CONDITION (S5-A2), the symmetric twin of the one
/// above and it exists for the symmetric reason.
///
/// OPEN-LONG is a DURATION measured against the clock. If the timecard sync has
/// not run in over a day, every open card looks long — not because anybody is
/// still on the floor but because Froot stopped being told. Raising OPEN-LONG on a
/// stale store would manufacture a floor full of alarms out of one failed sync,
/// which is precisely the "absent data rendered as a measurement" seam (c) forbids.
///
/// OPEN-STALE IS DELIBERATELY NOT SUPPRESSED BY THIS. It is a DATE COMPARISON, not
/// a duration: an open card whose start date precedes today is stale whether or
/// not the sync is healthy, and on a store whose sync is broken it is the single
/// most important thing on the page. Suppressing it would blind the page at the
/// exact moment it matters most. Its label carries the sync stamp instead.
export function durationFlagsSuppressed(timecardHealth: LaborHealth): boolean {
  return timecardHealth !== "fresh"
}

// ─── SHAPES ───────────────────────────────────────────────────────────────────

export type FlagCode = "OPEN-STALE" | "OPEN-LONG" | "DOUBLE" | "UNMAPPED" | "NO-SHOW" | "UNSCHEDULED"

/// S5-A13 — THE EXPLANATORY SENTENCES, COMPOSED SERVER-SIDE.
///
/// They used to be JSX conditions in the client, each reading a different payload
/// field. That is how A12's sentence went missing on staging while every fixture
/// stayed green: the fixtures asserted the COUNT the sentence was derived from,
/// and nothing anywhere asserted that a sentence had actually been produced. A
/// field can be correct and unreachable at the same time, and the client is where
/// that gap lives.
///
/// Composing them here closes the gap by construction. The payload now carries
/// the sentence a reader will see, so a fixture can assert THE STRING — the
/// surface that was actually broken — rather than an input it is computed from.
/// The client's job shrinks to rendering an array it does not filter.
export type InspectorNoticeCode =
  | "schedule-suppressed"
  | "no-show-pending"
  | "unassigned-shifts"
  | "duration-suppressed"

export type InspectorNotice = { code: InspectorNoticeCode; text: string }

export const FLAG_CODES: FlagCode[] = ["OPEN-STALE", "OPEN-LONG", "DOUBLE", "UNMAPPED", "NO-SHOW", "UNSCHEDULED"]

/// The timecard row shape the assembly needs. NOTE WHAT IS ABSENT, exactly as in
/// ClockedInCoverageRow: no wageHourlyRate, no wageTipEligible, no
/// declaredCashTips. The ruling is enforced by getDayInspector not selecting them.
export type InspectorTimecardRow = {
  squareTeamMemberId: string
  startAt: Date
  endAt: Date | null
  /// Square's own OPEN/CLOSED. Carried because a row whose status disagrees with
  /// its endAt is itself a finding, and this page is where you would look for one.
  status: string
  breakPaidMinutes: number
  breakUnpaidMinutes: number
  wageJobId: string | null
  wageTitle: string | null
}

/// The scheduled-shift row shape. NOTE WHAT IS ABSENT: no notes column, and no
/// column that could carry one. Same ruling, same enforcement.
export type InspectorShiftRow = {
  effectiveTeamMemberId: string | null
  effectiveStartAt: Date
  effectiveEndAt: Date
  effectiveJobId: string
  effectiveSource: string
  effectiveIsDeleted: boolean
}

/// One bar on the timeline — a timecard, or a ghosted scheduled shift.
///
/// PERCENTAGES ARE SERVER-COMPUTED, and so are every label on them. The store's
/// timezone lives on the server and the conversion happens where the answer is
/// known — the S4 posture for clockInAt, applied to a whole row. A bare instant
/// plus a timezone field would be one more chance for a surface to render a UTC
/// hour and call it 9am, and this page adds ZERO new client-side format() sites.
export type InspectorBar = {
  /// Opaque and render-only. NOT Square's timecard id and NOT a team member id.
  key: string
  startPct: number
  endPct: number
  startLabel: string
  /// Null = the card is still open.
  endLabel: string | null
  open: boolean
  /// Clipped at the day's edges — the card runs on either side of what is drawn.
  continuesBefore: boolean
  continuesAfter: boolean
  jobId: string
  title: string | null
  /// "Aug 19" when this row's own business day is NOT the viewed date; null when
  /// they agree. BUG-10's date qualifier, generalised: a card that belongs to
  /// another day is LABELLED, never dropped.
  startedOn: string | null
  flags: FlagCode[]
  /// Pre-formatted, e.g. "2:55p → open · 7.0h paid · 30m unpaid break".
  detail: string
}

export type InspectorPerson = {
  /// Opaque — `p0`, `p1`, … assigned after sorting, or `open-shifts` for the
  /// unassigned row. THE SQUARE TEAM MEMBER ID IS NEVER EMITTED.
  key: string
  /// "Unnamed" where Square knows this person and Froot does not. S4's D6 posture:
  /// a real state, not a gap to be filled, and never a reason to drop the row.
  name: string
  unmapped: boolean
  flags: FlagCode[]
  /// S5-A10 — PAID TIME, breaks deducted, the same paidMinutesOf the dashboard
  /// divides by. NEVER the wall-clock length of the bars, which is a different
  /// number and would disagree with every other labor surface. Null on the
  /// unassigned-shifts row, which has no timecards to total.
  paidLabel: string | null
  bars: InspectorBar[]
  ghosts: InspectorBar[]
}

export type DayInspectorResult = {
  date: string
  /// DST-honest: 23 entries on a spring-forward day, 25 on a fall-back one,
  /// because both ends come from localMidnightUtc rather than from arithmetic.
  hourTicks: { pct: number; label: string }[]
  people: InspectorPerson[]
  counts: Record<FlagCode, number>
  /// S5-A6 — CARDS ON THE FLOOR DURING THIS DAY, which is NOT the same population
  /// as /labor's day totals. See the comment on assembleDayInspector.
  cardsOnFloor: number
  jobIds: string[]
  /// True = NO-SHOW and UNSCHEDULED were not computed. The page says so in a
  /// sentence rather than rendering zeros that would read as "no variance".
  scheduleSuppressed: boolean
  /// S5-A12 — assigned shifts the timecard sync has not reached yet, so NO-SHOW
  /// could not be evaluated for them. They render as plain ghosts and the page
  /// NAMES THE COUNT: silently omitting them would put the reader back where the
  /// false-positive did, believing the page had checked something it had not.
  noShowPendingCount: number
  /// Pre-formatted store-local instant the NO-SHOW horizon sits at, e.g.
  /// "10:15p Aug 20". Null = the timecard sync has never succeeded for this store,
  /// which is a different sentence and the page renders it as one.
  noShowHorizonLabel: string | null
  /// S5-A13 — scheduled shifts with nobody assigned in Square. Twelve of 462
  /// observed shifts are open shifts (S1b § 3), and they are the case that made
  /// A12's sentence unreachable: they can NEVER be a no-show — there is nobody to
  /// fail to show — so they are not "not yet evaluated", they are never evaluated.
  /// Counted separately because saying otherwise about them would be false.
  unassignedShiftCount: number
  /// EVERY EXPLANATORY SENTENCE THIS DAY NEEDS, in render order, pre-composed.
  /// The client renders the array and filters nothing.
  notices: InspectorNotice[]
  /// True = OPEN-LONG was not computed, because the timecard sync is not fresh.
  durationSuppressed: boolean
}

// ─── PURE: THE ASSEMBLY ───────────────────────────────────────────────────────

/// PURE — no DB, no network, injected timezone, injected clock, injected
/// thresholds. Its fixture is scripts/verify-labor-inspector.ts.
///
/// THE POPULATION IS "ON THE FLOOR DURING THIS DAY", NOT "BELONGS TO THIS DAY",
/// AND THE TWO DO NOT RECONCILE (S5-A6). Square's own business day — and therefore
/// getLaborActuals, and therefore /labor — anchors a timecard to the store-local
/// date of its startAt (`workday` + `match_timecards_by: "START_AT"`,
/// labor-actuals.ts). A timeline cannot use that rule: a card running 22:00→02:00
/// is on the floor during both days, and drawing it on only one of them would
/// leave the other day's 00:00–02:00 mysteriously empty. So this page counts
/// OVERLAP, a midnight-spanning card appears in BOTH days' views by design, and
/// the totals here will not add up to /labor's. That is stated on the page rather
/// than left for someone to discover by subtraction.
export function assembleDayInspector({
  timecards,
  shifts,
  namesBySquareId,
  date,
  timeZone,
  now,
  hasSchedule,
  timecardSyncOkAt,
  durationSuppressed,
  thresholds = DEFAULT_INSPECTOR_THRESHOLDS,
}: {
  timecards: InspectorTimecardRow[]
  shifts: InspectorShiftRow[]
  namesBySquareId: Map<string, string>
  date: string
  timeZone: string
  now: Date
  /// scheduleComparable()'s answer, computed by the caller because it needs the
  /// sync state this function deliberately never sees.
  hasSchedule: boolean
  /// S5-A2 — the ceiling OPEN-LONG measures against. An open card's duration is
  /// only KNOWN up to the last successful sync; past that Froot is guessing.
  timecardSyncOkAt: Date | null
  /// durationFlagsSuppressed()'s answer, same reasoning as hasSchedule.
  durationSuppressed: boolean
  thresholds?: InspectorThresholds
}): DayInspectorResult {
  const dayStart = localMidnightUtc(date, timeZone).getTime()
  const dayEnd = localMidnightUtc(addDaysStr(date, 1), timeZone).getTime()
  const spanMs = dayEnd - dayStart

  // THE BAR CEILING IS S3's, UNCHANGED — the earlier of `now` and the day's end.
  // An open card occupies hours up to where the day has actually got to and never
  // beyond, and one left open on a PAST day is clamped to that day rather than
  // running to now. Reused rather than re-derived so the timeline and the curve
  // cannot disagree about where an open card stops.
  const ceilingMs = Math.min(now.getTime(), dayEnd)

  // HOW FAR THE TIMECARD SYNC HAS ACTUALLY REACHED — and this one is different
  // from the bar ceiling on purpose. Using the bar ceiling for a flag would let a
  // store whose sync died on Tuesday grow a fresh crop of alarms every day after.
  // The asymmetry is the point: the BAR draws what the day looked like, a FLAG
  // measures only what we actually know.
  //
  // ONE EXPRESSION, TWO FLAGS, DELIBERATELY. OPEN-LONG (S5-A2) and NO-SHOW
  // (S5-A12) both rest on it, and writing it once is what makes the shared rule
  // structural rather than a coincidence between two similar-looking lines: no
  // flag derived from duration or from absence may assert anything about a window
  // the sync has not reached. UNSCHEDULED is evidence-positive and needs neither.
  const syncedThroughMs =
    timecardSyncOkAt === null ? null : Math.min(now.getTime(), timecardSyncOkAt.getTime())

  const today = localDateStr(now, timeZone)
  const counts: Record<FlagCode, number> = {
    "OPEN-STALE": 0,
    "OPEN-LONG": 0,
    DOUBLE: 0,
    UNMAPPED: 0,
    "NO-SHOW": 0,
    UNSCHEDULED: 0,
  }

  // ── group by team member ───────────────────────────────────────────────────
  const cardsBy = new Map<string, InspectorTimecardRow[]>()
  for (const tc of timecards) {
    const list = cardsBy.get(tc.squareTeamMemberId)
    if (list) list.push(tc)
    else cardsBy.set(tc.squareTeamMemberId, [tc])
  }
  // Tombstones are filtered on read AND on the row, the redundancy OVL-S4 ratified:
  // "a deleted shift is not scheduled labour" becomes a property the fixture can
  // prove without a database.
  const liveShifts = shifts.filter((s) => !s.effectiveIsDeleted)
  const shiftsBy = new Map<string, InspectorShiftRow[]>()
  const unassignedShifts: InspectorShiftRow[] = []
  for (const s of liveShifts) {
    if (s.effectiveTeamMemberId === null) {
      unassignedShifts.push(s)
      continue
    }
    const list = shiftsBy.get(s.effectiveTeamMemberId)
    if (list) list.push(s)
    else shiftsBy.set(s.effectiveTeamMemberId, [s])
  }

  const memberIds = [...new Set([...cardsBy.keys(), ...shiftsBy.keys()])]
  const jobIds = new Set<string>()
  let cardsOnFloor = 0
  // S5-A12 — assigned shifts the sync has not reached yet. Counted only where the
  // schedule is comparable at all, so a store with no plan produces ONE sentence
  // (schedule suppressed) rather than two saying overlapping things.
  let noShowPending = 0

  type Draft = {
    name: string
    unmapped: boolean
    flags: Set<FlagCode>
    paidMinutes: number
    hasCards: boolean
    bars: Omit<InspectorBar, "key">[]
    ghosts: Omit<InspectorBar, "key">[]
  }
  const drafts: Draft[] = []

  for (const memberId of memberIds) {
    const cards = cardsBy.get(memberId) ?? []
    const memberShifts = shiftsBy.get(memberId) ?? []
    const resolved = namesBySquareId.get(memberId)?.trim()
    const unmapped = !resolved
    const flags = new Set<FlagCode>()
    if (unmapped) flags.add("UNMAPPED")

    // DOUBLE — pairwise within this member. O(n²) over one person's cards in one
    // day, which is at most a handful; the clarity is worth more than the loop.
    const doubled = new Set<number>()
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const overlap =
          Math.min(clockedEndMs(cards[i], ceilingMs), clockedEndMs(cards[j], ceilingMs)) -
          Math.max(cards[i].startAt.getTime(), cards[j].startAt.getTime())
        if (overlap >= thresholds.doubleMinOverlapMinutes * 60000) {
          doubled.add(i)
          doubled.add(j)
        }
      }
    }
    if (doubled.size > 0) flags.add("DOUBLE")

    let paidMinutes = 0
    const bars: Omit<InspectorBar, "key">[] = []

    cards.forEach((tc, index) => {
      const barFlags = new Set<FlagCode>()
      if (doubled.has(index)) barFlags.add("DOUBLE")
      if (unmapped) barFlags.add("UNMAPPED")

      const startedDate = localDateStr(tc.startAt, timeZone)
      const isOpen = tc.endAt === null

      // OPEN-STALE — a date comparison against store-local TODAY, never against
      // the viewed day. A card opened on the 19th is stale when read on the 21st
      // whichever of those two days you happen to be looking at.
      if (isOpen && startedDate < today) {
        barFlags.add("OPEN-STALE")
        flags.add("OPEN-STALE")
      }
      // OPEN-LONG — today's cards only (a prior-day open card is OPEN-STALE, which
      // is the stronger and more specific statement), and only where the sync is
      // fresh enough for a duration to mean anything.
      if (isOpen && startedDate === today && !durationSuppressed && syncedThroughMs !== null) {
        const openMinutes = (syncedThroughMs - tc.startAt.getTime()) / 60000
        if (openMinutes >= thresholds.openLongHours * 60) {
          barFlags.add("OPEN-LONG")
          flags.add("OPEN-LONG")
        }
      }
      // UNSCHEDULED — no scheduled shift of this member's overlaps this card by
      // enough to count as attendance.
      if (hasSchedule) {
        const matched = memberShifts.some(
          (s) =>
            overlapMinutes(
              tc.startAt.getTime(),
              clockedEndMs(tc, ceilingMs),
              s.effectiveStartAt.getTime(),
              s.effectiveEndAt.getTime()
            ) >= thresholds.showedUpMinOverlapMinutes
        )
        if (!matched) {
          barFlags.add("UNSCHEDULED")
          flags.add("UNSCHEDULED")
        }
      }

      const jobId = tc.wageJobId ?? UNKNOWN_JOB_ID
      jobIds.add(jobId)

      const minutes = paidMinutesOf(tc, ceilingMs)
      if (minutes !== null) paidMinutes += minutes
      cardsOnFloor++

      const endMs = clockedEndMs(tc, ceilingMs)
      const detailBits = [
        `${formatClockInLabel(tc.startAt, timeZone)} → ${tc.endAt ? formatClockInLabel(tc.endAt, timeZone) : "open"}`,
      ]
      if (minutes !== null) detailBits.push(`${(minutes / 60).toFixed(1)}h paid`)
      if (tc.breakUnpaidMinutes > 0) detailBits.push(`${tc.breakUnpaidMinutes}m unpaid break`)
      if (tc.breakPaidMinutes > 0) detailBits.push(`${tc.breakPaidMinutes}m paid break`)
      // A row whose Square status disagrees with its own endAt is itself a
      // finding. Named rather than smoothed over.
      if (isOpen && tc.status !== "OPEN") detailBits.push(`Square status ${tc.status}`)

      bars.push({
        ...spanOf(tc.startAt.getTime(), endMs, dayStart, dayEnd, spanMs),
        startLabel: formatClockInLabel(tc.startAt, timeZone),
        endLabel: tc.endAt ? formatClockInLabel(tc.endAt, timeZone) : null,
        open: isOpen,
        jobId,
        title: tc.wageTitle,
        startedOn: startedDate === date ? null : shortDate(startedDate),
        flags: [...barFlags],
        detail: detailBits.join(" · "),
      })
    })

    // NO-SHOW — a scheduled shift nobody's card overlaps by enough to count, AND
    // ONLY ONCE THE SYNC HAS REACHED PAST ITS START PLUS GRACE (S5-A12). A shift
    // that is not yet eligible is neither flagged NOR counted: it renders as a
    // plain ghost, and the page says how many are waiting rather than hiding them.
    const ghosts = memberShifts.map((s) => {
      const ghostFlags = new Set<FlagCode>()
      if (hasSchedule) {
        if (!noShowEligible(s.effectiveStartAt, syncedThroughMs, thresholds.noShowGraceMinutes)) {
          noShowPending++
        } else {
          const matched = cards.some(
            (tc) =>
              overlapMinutes(
                tc.startAt.getTime(),
                clockedEndMs(tc, ceilingMs),
                s.effectiveStartAt.getTime(),
                s.effectiveEndAt.getTime()
              ) >= thresholds.showedUpMinOverlapMinutes
          )
          if (!matched) {
            ghostFlags.add("NO-SHOW")
            flags.add("NO-SHOW")
          }
        }
      }
      jobIds.add(s.effectiveJobId)
      return ghostBar(s, timeZone, dayStart, dayEnd, spanMs, date, [...ghostFlags])
    })

    drafts.push({
      name: resolved ? resolved : "Unnamed",
      unmapped,
      flags,
      paidMinutes,
      hasCards: cards.length > 0,
      bars,
      ghosts,
    })
  }

  // Named first, alphabetical; "Unnamed" collects at the bottom instead of
  // scattering through the list — getStoreRoster's rule, restated so the two
  // person-listing surfaces sort the same way.
  drafts.sort((a, b) => {
    if (a.unmapped !== b.unmapped) return a.unmapped ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  const people: InspectorPerson[] = drafts.map((d, i) => {
    for (const f of d.flags) counts[f]++
    return {
      key: `p${i}`,
      name: d.name,
      unmapped: d.unmapped,
      flags: [...d.flags],
      paidLabel: d.hasCards ? `${(d.paidMinutes / 60).toFixed(1)}h paid` : null,
      bars: d.bars.map((b, bi) => ({ ...b, key: `p${i}b${bi}` })),
      ghosts: d.ghosts.map((g, gi) => ({ ...g, key: `p${i}g${gi}` })),
    }
  })

  // THE UNASSIGNED-SHIFT ROW, AND IT IS NOT DECORATION. Twelve of 462 observed
  // shifts carry no team member (S1b § 3) — open shifts nobody was assigned. They
  // are part of the plan, so dropping them would understate what was scheduled;
  // but they can never be a NO-SHOW, because there is nobody to fail to show.
  if (unassignedShifts.length > 0) {
    for (const s of unassignedShifts) jobIds.add(s.effectiveJobId)
    people.push({
      key: "open-shifts",
      name: "Unassigned shifts",
      unmapped: false,
      flags: [],
      paidLabel: null,
      bars: [],
      ghosts: unassignedShifts.map((s, gi) => ({
        ...ghostBar(s, timeZone, dayStart, dayEnd, spanMs, date, []),
        key: `og${gi}`,
      })),
    })
  }

  // THE HORIZON LABEL IS BUILT WHETHER OR NOT A SENTENCE USES IT, because it is a
  // fact about the store rather than about this day's shifts.
  const horizonLabel =
    syncedThroughMs === null
      ? null
      : `${formatClockInLabel(new Date(syncedThroughMs), timeZone)} ${shortDate(
          localDateStr(new Date(syncedThroughMs), timeZone)
        )}`

  const notices: InspectorNotice[] = []
  if (!hasSchedule) {
    notices.push({
      code: "schedule-suppressed",
      text:
        "No schedule data for this store-day, so No-show and Unscheduled are not computed. " +
        "Nothing here says a shift was unplanned — only that there is no plan to compare it against.",
    })
  }
  if (hasSchedule && noShowPending > 0) {
    notices.push({
      code: "no-show-pending",
      text:
        `${noShowPending} shift${noShowPending === 1 ? "" : "s"} not yet evaluated for no-show — ` +
        `${horizonLabel ? `timecards synced ${horizonLabel}` : "timecards have never synced for this store"}. ` +
        "A shift cannot be a no-show until the timecard sync has reached past its start; until then it is " +
        "drawn as a plain scheduled shift and counted nowhere.",
    })
  }
  // S5-A13 — THE CASE THAT WENT UNNAMED. Deliberately a DIFFERENT sentence from
  // the one above: an unassigned shift is not waiting on the sync, it is outside
  // the question entirely, and telling a manager it is "not yet evaluated" would
  // promise an evaluation that is never coming.
  if (hasSchedule && unassignedShifts.length > 0) {
    const n = unassignedShifts.length
    notices.push({
      code: "unassigned-shifts",
      text:
        `${n} scheduled shift${n === 1 ? " has" : "s have"} nobody assigned in Square, so no-show cannot ` +
        `apply to ${n === 1 ? "it" : "them"} — there is no one to fail to show. ` +
        `${n === 1 ? "It is" : "They are"} drawn as ${n === 1 ? "a plain scheduled shift" : "plain scheduled shifts"} and counted nowhere.`,
    })
  }
  if (durationSuppressed) {
    notices.push({
      code: "duration-suppressed",
      text:
        "The timecard sync is not fresh, so Open, long is not computed — every open card looks long once " +
        "Froot stops being told. Open, stale is still computed: it is a date comparison, and a broken sync " +
        "is exactly when it matters most.",
    })
  }

  return {
    date,
    hourTicks: hourTicks(dayStart, dayEnd, spanMs, timeZone),
    people,
    counts,
    cardsOnFloor,
    jobIds: [...jobIds].sort(),
    scheduleSuppressed: !hasSchedule,
    noShowPendingCount: noShowPending,
    unassignedShiftCount: unassignedShifts.length,
    notices,
    // THE DATE IS ALWAYS PRESENT, never dropped when the sync landed today. The
    // sentence this feeds is read while someone is deciding whether to believe a
    // flag, and "synced 10:15p" with no date is exactly the ambiguity that let the
    // UNR false-positive look reasonable for a morning.
    noShowHorizonLabel: horizonLabel,
    durationSuppressed,
  }
}

/// Overlap of two half-open intervals, in minutes. Zero where they merely touch or
/// miss entirely — never a negative, which would quietly read as "they matched".
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const ms = Math.min(aEnd, bEnd) - Math.max(aStart, bStart)
  return ms > 0 ? ms / 60000 : 0
}

/// The geometry of one bar: where it sits in the day, and whether it was clipped.
function spanOf(startMs: number, endMs: number, dayStart: number, dayEnd: number, spanMs: number) {
  const from = Math.max(startMs, dayStart)
  const to = Math.min(endMs, dayEnd)
  return {
    startPct: ((from - dayStart) / spanMs) * 100,
    endPct: ((Math.max(to, from) - dayStart) / spanMs) * 100,
    continuesBefore: startMs < dayStart,
    continuesAfter: endMs > dayEnd,
  }
}

function ghostBar(
  s: InspectorShiftRow,
  timeZone: string,
  dayStart: number,
  dayEnd: number,
  spanMs: number,
  date: string,
  flags: FlagCode[]
): Omit<InspectorBar, "key"> {
  const startedDate = localDateStr(s.effectiveStartAt, timeZone)
  const start = formatClockInLabel(s.effectiveStartAt, timeZone)
  const end = formatClockInLabel(s.effectiveEndAt, timeZone)
  return {
    ...spanOf(s.effectiveStartAt.getTime(), s.effectiveEndAt.getTime(), dayStart, dayEnd, spanMs),
    startLabel: start,
    endLabel: end,
    open: false,
    jobId: s.effectiveJobId,
    title: null,
    startedOn: startedDate === date ? null : shortDate(startedDate),
    flags,
    // The legend has to be able to say "this is the manager's draft, not what
    // staff were told" — effectiveSource is stored precisely so it can.
    detail: `scheduled ${start} → ${end}${s.effectiveSource === "draft" ? " · draft" : ""}`,
  }
}

/// Walks REAL hour boundaries from one store-local midnight to the next, so a
/// 23-hour or 25-hour DST day gets 23 or 25 ticks with correct labels rather than
/// 24 evenly-spaced lies.
function hourTicks(dayStart: number, dayEnd: number, spanMs: number, timeZone: string) {
  const out: { pct: number; label: string }[] = []
  for (let t = dayStart; t < dayEnd; t += 3600000) {
    out.push({ pct: ((t - dayStart) / spanMs) * 100, label: hourLabel(localHourOf(new Date(t), timeZone)) })
  }
  return out
}

/// The card's own convention — "12a", "9a", "12p", "3p" — so the axis on this page
/// reads like the axis on the Labor Coverage card.
function hourLabel(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

/// "Aug 19" from a yyyy-mm-dd. Formatted in UTC from the parts, never from a local
/// Date — the string is already store-local and re-zoning it would move the day.
function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
  return `${month} ${d}`
}

// ─── THE READS (DB) ───────────────────────────────────────────────────────────

export type TimecardSyncSummary = {
  health: LaborHealth
  lastSyncOkAt: string | null
  lastTimecardCount: number
}

/// The timecard sync's freshness, the twin of getScheduleSyncSummary.
///
/// PER STORE, and that is a fact about the schema rather than a choice made here:
/// SquareLaborSyncState.storeId is @unique (prisma/schema.prisma), organizationId
/// carries only a plain index, and both existing readers key on the store. An
/// org-level stamp on a per-store diagnostic would be worse than none.
///
/// NO `synced-empty` STATE, and the asymmetry with its twin is deliberate. A store
/// that synced fine with nobody clocked in is a QUIET DAY — an ordinary Tuesday
/// morning. A store with no scheduled shifts might be a quiet day OR a store that
/// has not adopted Square Scheduling at all, which is why the schedule side needs
/// the extra state and this side does not.
///
/// 26 HOURS, matching SCHEDULE_STALE_AFTER_MINUTES exactly (D5, 2026-08-20): two
/// labor syncs that went stale at different ages would put two differently-worded
/// warnings on one page for one outage.
export async function getTimecardSyncSummary(
  storeId: string,
  now = new Date()
): Promise<TimecardSyncSummary> {
  const state = await prisma.squareLaborSyncState.findUnique({
    where: { storeId },
    select: { lastSyncOkAt: true, lastError: true, lastTimecardCount: true },
  })
  return {
    health: computeHealth(state, now, DEFAULT_STALE_AFTER_MINUTES),
    lastSyncOkAt: state?.lastSyncOkAt?.toISOString() ?? null,
    lastTimecardCount: state?.lastTimecardCount ?? 0,
  }
}

/// How far back a CLOSED card may start and still be drawn on this day. Seven days
/// is generous for a shift and cheap on @@index([storeId, startAt]).
export const CLOSED_CARD_LOOKBACK_DAYS = 7

export type DayInspectorPayload = DayInspectorResult & {
  jobs: OverlayJob[]
  timecardSync: TimecardSyncSummary
  scheduleSync: ScheduleSyncSummary
}

/// The read path. NO SQUARE CALL — mirrored rows only, exactly like every other
/// overlay read, and NO SYNC IS TRIGGERED (read-only law, Gary 2026-08-21).
///
/// THE TIMECARD READ IS TWO QUERIES, AND THE SPLIT IS THE WHOLE POINT (S5-A1).
///
/// A single window with a lower bound recreates BUG-10's cliff one layer up. The
/// Las Brisas cards opened 2026-08-19 are STILL FROZEN OPEN; under a seven-day
/// floor they would simply leave the inspector's reach around Aug 26 — the page
/// built to find them would stop being able to, silently, and the older a phantom
/// got the more invisible it would become. That is the exact failure shape BUG-10
/// already cost a Neon session to diagnose.
///
/// So: CLOSED cards keep the floor, because a closed card that ended before this
/// day cannot be on the floor during it and an unbounded scan buys nothing. OPEN
/// cards get NO LOWER BOUND AT ALL — `endAt IS NULL AND startAt < dayEnd`, which
/// is still a range scan on @@index([storeId, startAt]) and is bounded in practice
/// by the fact that open cards are rare and CRON-1 now closes the genuine ones.
///
/// NEITHER EXISTING READ IS TOUCHED. getClockedInCoverage and getClockedInRoster
/// keep their 24h lookback and keep matching each other row for row — BUG-10's own
/// warning that part (2) must change both windows or neither. This is a third
/// window on a third surface, and it is wider because this surface's whole job is
/// to see what the other two are bounded away from.
export async function getDayInspector(
  organizationId: string,
  storeId: string,
  dateStr: string,
  now = new Date()
): Promise<DayInspectorPayload | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })
  if (!store) return null

  const dayStart = localMidnightUtc(dateStr, store.timezone)
  const dayEnd = localMidnightUtc(addDaysStr(dateStr, 1), store.timezone)
  const closedFloor = localMidnightUtc(addDaysStr(dateStr, -CLOSED_CARD_LOOKBACK_DAYS), store.timezone)

  // THE SELECT LISTS ARE THE RULINGS. wageHourlyRate, wageTipEligible and
  // declaredCashTips are on the timecard row and are not here; draftNotes and
  // publishedNotes are on the shift row and are not here. NOT FILTERED
  // AFTERWARDS — NOT FETCHED.
  const timecardSelect = {
    squareTeamMemberId: true,
    startAt: true,
    endAt: true,
    status: true,
    breakPaidMinutes: true,
    breakUnpaidMinutes: true,
    wageJobId: true,
    wageTitle: true,
  } as const

  const [closedCards, openCards, shifts, timecardSync, scheduleSync] = await Promise.all([
    prisma.squareTimecard.findMany({
      where: {
        storeId,
        startAt: { gte: closedFloor, lt: dayEnd },
        // `gt` on a nullable column already excludes NULL in SQL, so this selects
        // closed cards only and the two queries are disjoint by construction.
        endAt: { gt: dayStart },
      },
      select: timecardSelect,
    }),
    prisma.squareTimecard.findMany({
      where: { storeId, endAt: null, startAt: { lt: dayEnd } },
      select: timecardSelect,
    }),
    prisma.squareScheduledShift.findMany({
      where: {
        storeId,
        effectiveIsDeleted: false,
        effectiveStartAt: { lt: dayEnd },
        effectiveEndAt: { gt: dayStart },
      },
      select: {
        effectiveTeamMemberId: true,
        effectiveStartAt: true,
        effectiveEndAt: true,
        effectiveJobId: true,
        effectiveSource: true,
        effectiveIsDeleted: true,
      },
    }),
    getTimecardSyncSummary(storeId, now),
    getScheduleSyncSummary(storeId, now),
  ])

  const timecards = [...closedCards, ...openCards]

  // The join of record — StaffMember.squareTeamMemberId is org-unique and
  // displayName is the OPERATIONAL identity. The id goes in; no id comes out.
  const memberIds = [
    ...new Set([
      ...timecards.map((t) => t.squareTeamMemberId),
      ...shifts.map((s) => s.effectiveTeamMemberId).filter((v): v is string => v !== null),
    ]),
  ]
  const staff =
    memberIds.length > 0
      ? await prisma.staffMember.findMany({
          where: { organizationId, squareTeamMemberId: { in: memberIds } },
          select: { displayName: true, squareTeamMemberId: true },
        })
      : []
  const namesBySquareId = new Map(
    staff.filter((s) => s.squareTeamMemberId).map((s) => [s.squareTeamMemberId!, s.displayName])
  )

  const result = assembleDayInspector({
    timecards,
    shifts,
    namesBySquareId,
    date: dateStr,
    timeZone: store.timezone,
    now,
    hasSchedule: scheduleComparable(scheduleSync.health, shifts.filter((s) => !s.effectiveIsDeleted).length),
    timecardSyncOkAt: timecardSync.lastSyncOkAt ? new Date(timecardSync.lastSyncOkAt) : null,
    durationSuppressed: durationFlagsSuppressed(timecardSync.health),
  })

  return { ...result, jobs: await getOverlayJobs(organizationId, result.jobIds), timecardSync, scheduleSync }
}
