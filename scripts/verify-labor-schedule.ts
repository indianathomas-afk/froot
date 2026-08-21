/**
 * OVL-S2 acceptance fixture — the schedule-ingest pure layer.
 *
 *   npx tsx scripts/verify-labor-schedule.ts
 *
 * Pure functions, no DB and no network. Every case below is a rule someone could
 * plausibly "simplify" away, and each one costs real data if it goes:
 *
 *   1. effective = published ?? draft, INCLUDING the case where the two differ
 *      (22 of 399 observed) and the draft-only case (63 of 462).
 *   2. An UNASSIGNED shift — null team member, 12 of 462 — still counts toward
 *      coverage. A member-based count would erase them from the plan.
 *   3. A tombstoned shift (is_deleted, 21 of 462) is excluded on read.
 *   4. A response carrying a cursor SPLITS the window rather than following it,
 *      and a one-day window that still paginates is UNSPLITTABLE — a loud
 *      failure, never a silent partial result.
 *   5. Upsert idempotency, expressed as the guard's predicate: replaying a shift
 *      at a LOWER version is discarded, EQUAL and HIGHER are written.
 *   6. deterministicJobColor is stable, never grey, and spreads over the palette.
 *   7. The overlay-facing read function's output shape carries NO notes field —
 *      asserted structurally, on the real result object.
 *   8. OVL-S3 — the CLOCKED-IN curve: an open card is ceilinged at the current
 *      hour and never beyond, a cross-day open card is clamped to its own day,
 *      the end stays exclusive so the two curves bucket identically, and a
 *      clock-skewed row is dropped by the same test the cost calculation uses.
 *   9. OVL-S3 — colour resolution: an override beats the default, an unknown
 *      job falls back to the deterministic default, and every palette entry
 *      carries a hex so the Recharts stroke and the legend chip cannot drift.
 *  10. The protocol END TO END against a mocked page-fetcher — the cursor is
 *      dropped rather than followed, the paginated page is discarded rather than
 *      merged, both halves are re-queried, an unsplittable day throws, and a
 *      silently-ignored filter (S1b's 200-with-wrong-data trap) throws too.
 *
 * Observed counts cited above are from docs/prompts/Overlay_S1b_Probe_RESULTS.md
 * (n = 462, real Keva Square account, 2026-08-20).
 */
import {
  collectScheduledShifts,
  computeClockedInCoverage,
  computeScheduledCoverage,
  deterministicJobColor,
  effectiveShiftOf,
  planScheduleWindows,
  splitWindow,
  UNKNOWN_JOB_ID,
  type ClockedInCoverageRow,
  type ScheduledCoverageRow,
} from "../src/lib/labor-schedule"
import { BADGE_PRESETS, BADGE_PRESET_KEYS } from "../src/lib/badge-presets"
import { clockedEndMs, paidMinutesOf } from "../src/lib/labor-actuals"
import { readFileSync } from "fs"

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

// Square sends shift times ALREADY SHIFTED TO THE LOCATION'S OFFSET, never Z —
// so the fixture writes them that way too. A fixture that used Z would be
// testing a payload Square does not send. TZ throughout is America/Los_Angeles,
// the observed zone (-07:00 in August).
const TZ = "America/Los_Angeles"
function details(o: Partial<Record<string, unknown>> = {}) {
  return {
    location_id: "B95CJRCRDD91Y",
    job_id: "tVvhwvQ12FHG5RhzTpCvkWED",
    start_at: "2026-08-18T10:30:00-07:00",
    end_at: "2026-08-18T16:00:00-07:00",
    timezone: TZ,
    is_deleted: false,
    ...o,
  }
}

// ─── 1 · effective = published ?? draft ───────────────────────────────────────
{
  console.log("\n1 · the effective shift")

  const draftOnly = effectiveShiftOf({
    id: "MJ0JWXR12B8MB",
    draft_shift_details: details({ team_member_id: "TM3xMrcozhpb_gKJ" }),
  })
  check("draft-only falls back to the draft", draftOnly.source, "draft")
  check("and keeps the draft's team member", draftOnly.team_member_id, "TM3xMrcozhpb_gKJ")

  const differs = effectiveShiftOf({
    id: "MJ10WSYTGW1YQ",
    draft_shift_details: details({ start_at: "2026-08-19T06:30:00-07:00" }),
    published_shift_details: details({ start_at: "2026-08-19T08:00:00-07:00" }),
  })
  check("published wins where the two differ", differs.start_at, "2026-08-19T08:00:00-07:00")
  check("and the source says so", differs.source, "published")

  // ABSENCE IS THE TEST, NOT FALSINESS: the coalesce is on the OBJECT, so a
  // published shift that genuinely dropped its team member must NOT inherit the
  // draft's. A per-field `??` would silently re-assign an open shift.
  const dropped = effectiveShiftOf({
    id: "EMAJPVRW0137B",
    draft_shift_details: details({ team_member_id: "TM-4U2_5VtWlYJRj" }),
    published_shift_details: details({ team_member_id: null }),
  })
  check("a published shift does not inherit the draft's member", dropped.team_member_id, null)
}

// ─── 2, 3, 7 · the coverage read ──────────────────────────────────────────────
{
  console.log("\n2 · unassigned shifts, 3 · tombstones, 7 · no notes")

  function row(o: Partial<ScheduledCoverageRow> = {}): ScheduledCoverageRow {
    return {
      effectiveJobId: "tVvhwvQ12FHG5RhzTpCvkWED",
      // 10:30–16:00 local = hours 10…15 on the floor. 16:00 is an EXCLUSIVE end:
      // nobody is working during hour 16.
      effectiveStartAt: new Date("2026-08-18T10:30:00-07:00"),
      effectiveEndAt: new Date("2026-08-18T16:00:00-07:00"),
      effectiveSource: "published",
      ...o,
    }
  }

  const one = computeScheduledCoverage({ rows: [row()], date: "2026-08-18", timeZone: TZ })
  check("24 hourly points", one.points.length, 24)
  check("hour 10 is covered", one.points[10].scheduled, 1)
  check("hour 15 is covered", one.points[15].scheduled, 1)
  check("hour 16 is NOT — the end is exclusive", one.points[16].scheduled, 0)
  check("hour 9 is not yet covered", one.points[9].scheduled, 0)

  // An unassigned shift carries no team member at all. The row shape does not
  // even have the column — the count is of SHIFTS — so this is the assertion
  // that the count never became a distinct-member count.
  const withOpen = computeScheduledCoverage({
    rows: [row(), row({ effectiveJobId: "EcwRoP64JFZxQDFmZBV8iMGK" })],
    date: "2026-08-18",
    timeZone: TZ,
  })
  check("an unassigned shift still counts", withOpen.points[12].scheduled, 2)
  check("split by job id", withOpen.points[12].byJobId["EcwRoP64JFZxQDFmZBV8iMGK"], 1)
  check("both jobs in the legend", withOpen.jobIds.length, 2)

  // Tombstones: getScheduledCoverage filters effectiveIsDeleted at the QUERY, so
  // the pure layer never sees one. Asserted here as the contract the query owes
  // it — a deleted row reaching this function would be counted.
  check("the pure layer counts every row it is given", withOpen.shiftCount, 2)

  const drafted = computeScheduledCoverage({
    rows: [row({ effectiveSource: "draft" }), row()],
    date: "2026-08-18",
    timeZone: TZ,
  })
  check("draft-sourced shifts are counted for the legend", drafted.draftSourcedCount, 1)

  // An overnight shift belongs to BOTH days, split at store-local midnight —
  // never attributed whole to either.
  const overnight = computeScheduledCoverage({
    rows: [
      row({
        effectiveStartAt: new Date("2026-08-18T21:00:00-07:00"),
        effectiveEndAt: new Date("2026-08-19T02:00:00-07:00"),
      }),
    ],
    date: "2026-08-18",
    timeZone: TZ,
  })
  check("the evening half lands on the 18th", overnight.points[23].scheduled, 1)
  check("and hour 0 of the 18th is empty", overnight.points[0].scheduled, 0)

  const overnightNext = computeScheduledCoverage({
    rows: [
      row({
        effectiveStartAt: new Date("2026-08-18T21:00:00-07:00"),
        effectiveEndAt: new Date("2026-08-19T02:00:00-07:00"),
      }),
    ],
    date: "2026-08-19",
    timeZone: TZ,
  })
  check("the morning half lands on the 19th", overnightNext.points[1].scheduled, 1)
  check("and hour 21 of the 19th is empty", overnightNext.points[21].scheduled, 0)

  // 7 · THE NOTES RULING, ASSERTED ON THE SHAPE. Notes are never fetched, so no
  // key anywhere in this result may mention them. Checked over the whole
  // serialized object rather than a field list, so a field added later is caught.
  const serialized = JSON.stringify(one)
  check("no notes anywhere in the result", /note/i.test(serialized), false)
  check("no team member anywhere in the result", /team.?member/i.test(serialized), false)
}

// ─── 4 · the fetch protocol ───────────────────────────────────────────────────
{
  console.log("\n4 · window planning and the cursor split")

  const weeks = planScheduleWindows("2026-08-17", "2026-09-14")
  check("a 29-day horizon is 5 weekly windows", weeks.length, 5)
  check("the first starts at the range start", weeks[0].startDate, "2026-08-17")
  check("a weekly window is 7 days inclusive", weeks[0].endDate, "2026-08-23")
  check("windows are contiguous", weeks[1].startDate, "2026-08-24")
  check("the last is clamped to the range end", weeks[4].endDate, "2026-09-14")

  // A cursor came back ⇒ the window was too big ⇒ HALVE IT. The cursor is never
  // followed: S1b measured that following it loses 23% of rows per location even
  // with the location filter applied.
  const half = splitWindow({ startDate: "2026-08-17", endDate: "2026-08-23" })
  check("a week splits in two", half?.length, 2)
  check("the first half is 3 days", half?.[0].endDate, "2026-08-19")
  check("the second half picks up the next day", half?.[1].startDate, "2026-08-20")
  check("the second half keeps the end", half?.[1].endDate, "2026-08-23")

  const twoDays = splitWindow({ startDate: "2026-08-17", endDate: "2026-08-18" })
  check("two days split into one and one", twoDays?.[0].endDate, "2026-08-17")
  check("and the second is the second", twoDays?.[1].startDate, "2026-08-18")

  // THE FLOOR. A single store-day that still paginates cannot be read losslessly,
  // and the sync throws rather than storing a partial day — a truncated schedule
  // renders as "nobody is scheduled", which is the sentence seam (c) forbids.
  check("one day is unsplittable", splitWindow({ startDate: "2026-08-17", endDate: "2026-08-17" }), null)

  // Single-day ranges still plan as one window rather than none.
  check("a single-day range plans one window", planScheduleWindows("2026-08-17", "2026-08-17").length, 1)
}

// ─── 5 · the upsert guard ─────────────────────────────────────────────────────
{
  console.log("\n5 · upsert idempotency (the guard's predicate)")

  // The guard in SQL is `WHERE existing.squareVersion <= EXCLUDED.squareVersion`.
  // Asserted here as the predicate rather than against a database, so the fixture
  // stays pure — the SQL is one line and this is what it has to mean.
  const wins = (existing: number, incoming: number) => existing <= incoming
  check("a replay at the SAME version is written (refreshes syncedAt)", wins(7, 7), true)
  check("a HIGHER version is written", wins(7, 8), true)
  check("a LOWER version is discarded", wins(8, 7), false)
  // Version 1 is a real observed value (S1b: 1…17), so a zero-ish default must
  // not be able to beat it.
  check("version 0 cannot clobber version 1", wins(1, 0), false)
}

// ─── 6 · deterministic position colour ────────────────────────────────────────
{
  console.log("\n6 · deterministicJobColor")

  // The seven real job ids S1b found estate-wide.
  const JOB_IDS = [
    "HuymfGPFwvtc2b74qqi1kyKr",
    "tVvhwvQ12FHG5RhzTpCvkWED",
    "EcwRoP64JFZxQDFmZBV8iMGK",
    "Vo8oh22QmQAr3y2s1bkjF8fu",
    "UmRDFo2fhjqRRmZ67AAZh9oY",
    "bdowcCHo6qxZ9Ui7G42TUC7R",
    "J2B4akMW1pGzFVw8F98P49dJ",
  ]

  check(
    "stable across calls",
    deterministicJobColor(JOB_IDS[0]) === deterministicJobColor(JOB_IDS[0]),
    true
  )
  check(
    "every colour is a real badge preset key",
    JOB_IDS.every((j) => BADGE_PRESET_KEYS.includes(deterministicJobColor(j))),
    true
  )
  // Grey is what badgePreset() returns for an UNRECOGNISED key. A job legitimately
  // assigned grey would be indistinguishable from a broken one.
  check("never grey", JOB_IDS.some((j) => deterministicJobColor(j) === "gray"), false)
  check("the empty id is still a valid key", BADGE_PRESET_KEYS.includes(deterministicJobColor("")), true)

  // Not a uniqueness guarantee — 7 ids over 7 non-grey presets will collide, and
  // that is fine. What is asserted is that the hash SPREADS rather than
  // collapsing every id onto one colour, which a broken hash would do silently.
  const distinct = new Set(JOB_IDS.map(deterministicJobColor)).size
  check("the estate's seven jobs span more than two colours", distinct >= 3, true)
}

// ─── 8 · the protocol under a mock — where the law actually lives ────────────
// Async, so it runs after the synchronous sections above and owns the summary.
// ─── OVL-S3 · THE CLOCKED-IN CURVE ────────────────────────────────────────────
//
// Every case here is a rule that costs real data if it is "simplified" away. The
// ceiling ones matter most: without them an open timecard paints a full floor
// through midnight, and the actual curve claims staffing that has not happened.

function clockedInCases() {
  console.log("\nOVL-S3 · clocked-in coverage")

  const card = (o: Partial<ClockedInCoverageRow> = {}): ClockedInCoverageRow => ({
    startAt: new Date("2026-08-18T10:30:00-07:00"),
    endAt: new Date("2026-08-18T16:00:00-07:00"),
    breakUnpaidMinutes: 0,
    wageJobId: "tVvhwvQ12FHG5RhzTpCvkWED",
    ...o,
  })

  // Same shape, same boundaries as computeScheduledCoverage — the two curves sit
  // on one axis and must agree about what an hour is.
  const closed = computeClockedInCoverage({
    rows: [card()],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T23:00:00-07:00"),
  })
  check("24 hourly points", closed.points.length, 24)
  check("hour 10 is on the clock", closed.points[10].clockedIn, 1)
  check("hour 15 is on the clock", closed.points[15].clockedIn, 1)
  check("hour 16 is NOT — the end is exclusive", closed.points[16].clockedIn, 0)
  check("split by job id", closed.points[12].byJobId["tVvhwvQ12FHG5RhzTpCvkWED"], 1)
  check("a closed card is not counted open", closed.openCount, 0)

  // THE CEILING. An open card at 14:00 occupies through hour 13 and NOTHING
  // after — the store has not reached 15:00, so claiming a body there would be
  // inventing staffing.
  const open = computeClockedInCoverage({
    rows: [card({ endAt: null })],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T14:00:00-07:00"),
  })
  check("an open card covers the current hour's predecessor", open.points[13].clockedIn, 1)
  check("an open card NEVER covers a future hour", open.points[14].clockedIn, 0)
  check("nor the hour after that", open.points[15].clockedIn, 0)
  check("and it is reported as open", open.openCount, 1)

  // A CROSS-DAY OPEN CARD. Someone clocked in yesterday and never clocked out:
  // yesterday is clamped to its own midnight, not run forward to now.
  const crossDay = computeClockedInCoverage({
    rows: [card({ startAt: new Date("2026-08-17T22:00:00-07:00"), endAt: null })],
    date: "2026-08-17",
    timeZone: TZ,
    now: new Date("2026-08-18T14:00:00-07:00"),
  })
  check("yesterday's open card covers its own evening", crossDay.points[23].clockedIn, 1)
  check("and stops at that day's midnight", crossDay.points[0].clockedIn, 0)

  // The same card viewed on TODAY starts at midnight and stops at the ceiling.
  const crossDayToday = computeClockedInCoverage({
    rows: [card({ startAt: new Date("2026-08-17T22:00:00-07:00"), endAt: null })],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T14:00:00-07:00"),
  })
  check("today's half of it starts at hour 0", crossDayToday.points[0].clockedIn, 1)
  check("runs to the hour before now", crossDayToday.points[13].clockedIn, 1)
  check("and not past it", crossDayToday.points[14].clockedIn, 0)

  // A day that has not started yet in store-local terms: the ceiling is BEFORE
  // the day start, so the card contributes no hour rather than a negative span.
  const future = computeClockedInCoverage({
    rows: [card({ endAt: null })],
    date: "2026-08-19",
    timeZone: TZ,
    now: new Date("2026-08-18T14:00:00-07:00"),
  })
  check("a day the clock has not reached is empty", future.points.reduce((a, p) => a + p.clockedIn, 0), 0)

  // THE DROP TEST IS SHARED WITH THE COST CALCULATION. A clock-skewed row (end
  // before start) is dropped by paidMinutesOf, so it is dropped here too — the
  // chart and the labor % never disagree about which rows are real.
  const skewed = computeClockedInCoverage({
    rows: [card({ endAt: new Date("2026-08-18T09:00:00-07:00") })],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T23:00:00-07:00"),
  })
  check("a clock-skewed row is dropped", skewed.timecardCount, 0)
  check("paidMinutesOf agrees it contributes nothing", paidMinutesOf(card({ endAt: new Date("2026-08-18T09:00:00-07:00") }), Date.now()), null)

  // BREAKS ARE IGNORED BY RULING. An unpaid break shortens PAID minutes but not
  // the hours a person was on the premises — this curve counts heads, not cost.
  const withBreak = computeClockedInCoverage({
    rows: [card({ breakUnpaidMinutes: 60 })],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T23:00:00-07:00"),
  })
  check("an unpaid break does not remove an hour from the curve", withBreak.points[12].clockedIn, 1)
  check("though it does remove it from paid minutes", paidMinutesOf(card({ breakUnpaidMinutes: 60 }), Date.now()), 270)

  // The open-card rule lives in ONE place — this is the assertion that would fail
  // if it were ever re-derived in the overlay instead of imported.
  const ceiling = new Date("2026-08-18T14:00:00-07:00").getTime()
  check("clockedEndMs ceilings an open card", clockedEndMs({ endAt: null }, ceiling), ceiling)
  check("and leaves a closed one alone", clockedEndMs({ endAt: new Date("2026-08-18T16:00:00-07:00") }, ceiling), new Date("2026-08-18T16:00:00-07:00").getTime())

  // A timecard with no job still counts — the person was there. It lands under
  // the sentinel rather than being dropped or crashing the colour map.
  const noJob = computeClockedInCoverage({
    rows: [card({ wageJobId: null })],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T23:00:00-07:00"),
  })
  check("a job-less timecard still counts", noJob.points[12].clockedIn, 1)
  check("under the unknown-job sentinel", noJob.points[12].byJobId[UNKNOWN_JOB_ID], 1)
  check("which is the id the legend is given", noJob.jobIds[0], UNKNOWN_JOB_ID)

  // COUNTS TIMECARDS, NOT DISTINCT PEOPLE — the same choice the scheduled curve
  // makes for shifts, so the two are commensurable.
  const two = computeClockedInCoverage({
    rows: [card(), card({ wageJobId: "EcwRoP64JFZxQDFmZBV8iMGK" })],
    date: "2026-08-18",
    timeZone: TZ,
    now: new Date("2026-08-18T23:00:00-07:00"),
  })
  check("two on the floor at noon", two.points[12].clockedIn, 2)
  check("both jobs in the legend", two.jobIds.length, 2)

  // STRUCTURAL: no wage, no rate, no team member anywhere in the output. The
  // overlay is STORE-visible and STORE accounts are shared iPad logins.
  const serialized = JSON.stringify(two)
  check("no wage in the output", /wage|rate|tip|salar/i.test(serialized), false)
  check("no team member in the output", /teamMember|memberId/i.test(serialized), false)

  // hour >= 6 PARITY. The card filters both curves with the same predicate, so
  // the two series must expose the same hours to filter.
  const sched = computeScheduledCoverage({
    rows: [{ effectiveJobId: "J", effectiveStartAt: new Date("2026-08-18T10:30:00-07:00"), effectiveEndAt: new Date("2026-08-18T16:00:00-07:00"), effectiveSource: "published" }],
    date: "2026-08-18",
    timeZone: TZ,
  })
  check("both curves expose the same hour domain", sched.points.map((p) => p.hour).join(), closed.points.map((p) => p.hour).join())
  check("and both survive the hour>=6 filter identically", sched.points.filter((p) => p.hour >= 6).length, closed.points.filter((p) => p.hour >= 6).length)
}

// ─── OVL-S3 · ABSENCE, NOT EMPTINESS ──────────────────────────────────────────
//
// A SOURCE GUARD, AND DELIBERATELY SO. The rule is that a viewer without
// labor.schedule.view gets NO `overlay` key — not null, not {} — and the only
// honest way to assert that without a database is to check the shape of the code
// that emits it. Asserting it on a hand-built object would test JSON.stringify
// rather than the route.
//
// What it catches is the real regression: someone "tidying" the conditional
// spread into a plain `overlay,` or an `overlay: overlay ?? null`. Either would
// ship an empty overlay to a denied viewer, which is the difference between a
// payload that cannot leak and one that merely does not.

function absenceCases() {
  console.log("\nOVL-S3 · absence, not emptiness")

  const route = readFileSync(
    new URL("../src/app/api/labor/coverage/route.ts", import.meta.url),
    "utf8"
  )

  check(
    "the overlay is gated on the capability",
    /can\(ctx\.actor,\s*"labor\.schedule\.view"\)/.test(route),
    true
  )
  check(
    "and spread CONDITIONALLY, so the key is absent when denied",
    /\.\.\.\(overlay \? \{ overlay \} : \{\}\)/.test(route),
    true
  )
  check(
    "the route never emits an empty overlay",
    /overlay:\s*(null|\{\}|overlay \?\? null)/.test(route),
    false
  )
  check(
    "the denied path builds nothing at all",
    /:\s*undefined\b/.test(route),
    true
  )
}

// ─── OVL-S3 · COLOUR RESOLUTION ───────────────────────────────────────────────

function colorCases() {
  console.log("\nOVL-S3 · colour resolution")

  // EVERY preset carries a hex, because ONE key has to drive both the Recharts
  // stroke (an inline SVG attribute Tailwind cannot reach) and the legend chip.
  // A missing hex renders an invisible line, which is the failure this catches.
  const missingHex = BADGE_PRESET_KEYS.filter((k) => !/^#[0-9a-f]{6}$/i.test(BADGE_PRESETS[k].hex))
  check("every preset has a 6-digit hex", missingHex.length, 0)
  check("every preset still has its dot class", BADGE_PRESET_KEYS.filter((k) => !BADGE_PRESETS[k].dot).length, 0)

  // The resolution rule the overlay and the settings editor both apply: a stored
  // override wins; anything else falls back to the deterministic default.
  const resolve = (jobId: string, stored?: string) =>
    stored && BADGE_PRESET_KEYS.includes(stored as never) ? stored : deterministicJobColor(jobId)

  const jobId = "tVvhwvQ12FHG5RhzTpCvkWED"
  check("an override beats the default", resolve(jobId, "purple"), "purple")
  check("no row falls back to the deterministic default", resolve(jobId), deterministicJobColor(jobId))
  check("and a junk stored key falls back too", resolve(jobId, "chartreuse"), deterministicJobColor(jobId))
  check("the default is stable across calls", deterministicJobColor(jobId), deterministicJobColor(jobId))
  check("an unknown job still gets a colour", BADGE_PRESET_KEYS.includes(deterministicJobColor(UNKNOWN_JOB_ID)), true)
}

async function protocolCases() {
  console.log("\n8 · collectScheduledShifts against a mock (no network)")

  const shift = (id: string, startAt: string) => ({
    id,
    draft_shift_details: details({ start_at: startAt, end_at: startAt }),
  })
  const OPTS = {
    startDate: "2026-08-17",
    endDate: "2026-08-23",
    locationId: "B95CJRCRDD91Y",
    timeZone: TZ,
  }

  // The happy path: one week, one request, no cursor.
  const asked: string[] = []
  const clean = await collectScheduledShifts(async (w) => {
    asked.push(`${w.startDate}..${w.endDate}`)
    return { shifts: [shift("A", "2026-08-18T10:00:00-07:00")] }
  }, OPTS)
  check("a single-page week is one request", clean.requests, 1)
  check("no splits", clean.splits, 0)
  check("the shift is collected", clean.shifts.length, 1)

  // THE LAW. The first request returns a cursor; the halves do not. The cursor
  // must NEVER be sent back, the paginated page must be DROPPED, and both halves
  // must be re-queried from scratch.
  const seen: string[] = []
  let first = true
  const split = await collectScheduledShifts(async (w) => {
    seen.push(`${w.startDate}..${w.endDate}`)
    if (first) {
      first = false
      return { shifts: [shift("PAGE1", "2026-08-18T10:00:00-07:00")], cursor: "eyJzdGFydF9hdCI6" }
    }
    return { shifts: [shift(`OK-${w.startDate}`, `${w.startDate}T10:00:00-07:00`)] }
  }, OPTS)
  check("a cursor causes exactly one split", split.splits, 1)
  check("three requests: the too-big window, then both halves", split.requests, 3)
  check("the whole week was asked for first", seen[0], "2026-08-17..2026-08-23")
  check("then the first half", seen[1], "2026-08-17..2026-08-19")
  check("then the second half", seen[2], "2026-08-20..2026-08-23")
  check("the paginated page is DROPPED, not merged", split.shifts.some((p) => p.id === "PAGE1"), false)
  check("only the re-queried halves are kept", split.shifts.length, 2)

  // THE FLOOR. A one-day window that still paginates cannot be read losslessly,
  // so it throws — a partial schedule renders as "nobody is scheduled".
  let threw = ""
  try {
    await collectScheduledShifts(
      async () => ({ shifts: [], cursor: "still-more" }),
      { ...OPTS, startDate: "2026-08-17", endDate: "2026-08-17" }
    )
  } catch (e) {
    threw = e instanceof Error ? e.message.split(":")[0] : "non-error"
  }
  check("an unsplittable paginated day throws", threw, "SQUARE_SCHEDULE_WINDOW_UNSPLITTABLE")

  // THE TRIPWIRE for S1b's 200-with-wrong-data trap: an unknown filter field is
  // silently accepted and the full estate comes back. A shift from another
  // location must fail the sync loudly rather than land in the database.
  let ignored = ""
  try {
    await collectScheduledShifts(
      async () => ({ shifts: [{ id: "X", draft_shift_details: details({ location_id: "5T81ZVHA923D4" }) }] }),
      OPTS
    )
  } catch (e) {
    ignored = e instanceof Error ? e.message.split(":")[0] : "non-error"
  }
  check("a foreign location throws FILTER_IGNORED", ignored, "SQUARE_SCHEDULE_FILTER_IGNORED")

  let outOfWindow = ""
  try {
    await collectScheduledShifts(
      async () => ({ shifts: [shift("Y", "2026-09-30T10:00:00-07:00")] }),
      OPTS
    )
  } catch (e) {
    outOfWindow = e instanceof Error ? e.message.split(":")[0] : "non-error"
  }
  check("an out-of-window shift throws FILTER_IGNORED", outOfWindow, "SQUARE_SCHEDULE_FILTER_IGNORED")

  // …but the one-day slack keeps the tripwire off legitimate boundary shifts.
  const boundary = await collectScheduledShifts(
    async () => ({ shifts: [shift("Z", "2026-08-24T02:00:00-07:00")] }),
    OPTS
  )
  check("a shift just past the boundary is tolerated", boundary.shifts.length, 1)
}

clockedInCases()
colorCases()
absenceCases()

protocolCases().then(() => {
  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}\n`)
  process.exit(failures === 0 ? 0 : 1)
})
