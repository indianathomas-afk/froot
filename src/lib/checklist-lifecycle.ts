import { OPERATIONAL_PHASES, normalizePhase, type OperationalPhase } from "@/lib/phases"

// ─── Checklist lifecycle (CHK-3) ─────────────────────────────────────────────
// ONE definition of "when was this checklist expected, when does its day end,
// and what state is it in", for every surface that will ever ask. Deliberately
// free of Prisma and React imports so server components, client components and
// API routes can all use it — the src/lib/phases.ts and src/lib/sections.ts
// precedent, with Prisma rows passed in as plain shapes rather than imported as
// types.
//
// THE SPLIT THIS FILE EXISTS TO HOLD (Gary's R1/R2, plan §3.3):
//   OVERDUE IS EVALUATED ON READ — a live nagging state. No write, no
//   scheduler, correct the instant an offset changes, nothing to keep in sync.
//   MISSED AND COMPLETED-LATE ARE WRITTEN — a closed fact, and a fact needs a
//   writer. The writer is GET /api/cron/checklist-day-close, and only it.
//
// Per DEBT-26's discipline the predicates live here and NOWHERE else. A comment
// elsewhere points at this file rather than restating the set — restating it is
// the specific mistake DEBT-26 closed on.
//
// NO UI READS ANY OF THIS YET. CHK-4 (S4) owns every pixel; CHK-3 ships the
// engine and proves it through SQL and the cron's response body.

/**
 * Day close = store close + this many hours. A CONSTANT, not a per-org column
 * (plan §3.2, ruled 2026-08-09).
 *
 * Three hours after close covers a real closing crew finishing up and still
 * lands the close before the next opening for any plausible schedule.
 * `Organization.handoffNoteExpireDays` is precedent for a per-org grace, so the
 * door is open — but DEBT-59's line is *visible and editable* versus *silent and
 * persisted*, and a per-org column with no Settings control is the silent side
 * of it. A constant is neither persisted nor claimed as chosen. If an operator
 * ever asks for a different buffer, that is a row: an
 * `Organization.checklistDayCloseGraceHours` column plus a Settings control,
 * shipped together.
 */
export const DAY_CLOSE_GRACE_HOURS = 3

/** How many business days back the day-close job looks (plan §3.4). */
export const DAY_CLOSE_LOOKBACK_DAYS = 2

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// ─── Shapes, structural rather than Prisma types ─────────────────────────────

/** One `StoreHours` row. `dayOfWeek` is 0 Sun … 6 Sat — the JS convention, and
 *  what every existing reader and the CHK-2 writer index by. */
export interface HoursRow {
  dayOfWeek: number
  openingTime: string | null
  closingTime: string | null
  isClosed: boolean
}

/** The fields of `Template` that define an expected window. */
export interface WindowTemplate {
  availabilityType: string
  operationalPhase: string | null
  startOffsetHours: number | null
  endOffsetHours: number | null
}

/** The fields of `Checklist` the predicates read. */
export interface LifecycleChecklist {
  status: string
  closedAt: Date | null
  completedLate?: boolean
}

/** An expected window. Either side may be null — see `expectedWindow`. */
export interface ExpectedWindow {
  start: Date | null
  end: Date | null
}

export type ChecklistState =
  | "upcoming" // an expected window exists and has not started
  | "active" // inside the expected window, or no window and day still open
  | "overdue" // window end passed, day not yet closed, not completed
  | "completed" // Completed (completedLate is a separate flag, not a state)
  | "missed" // closedAt set, not completed — a closed fact

/**
 * WHY THE DAY ENDED WHEN IT DID. The engine must expose the fallback state
 * queryably (the two VISIBLE signals — a note on /stores, a column on the
 * operations report — are CHK-4/CHK-5 surface work, and they read this).
 *
 *   "hours"        — a usable closing time for that weekday drove it
 *   "closed-day"   — the store is marked closed that weekday; midnight + buffer
 *   "no-hours"     — no StoreHours row for that weekday; midnight + buffer
 *   "no-close-time"— a row exists but its closing time is absent or unparseable;
 *                    midnight + buffer
 *
 * The last three are all the ruled midnight fallback (plan §3.1 option (ii)).
 * They are kept apart because "the operator marked Sunday closed" and "nobody
 * has ever set this store's hours" are different facts about a store, and a
 * report that merges them tells an operator to go fix something they already
 * did.
 */
export type DayCloseSource = "hours" | "closed-day" | "no-hours" | "no-close-time"

export interface DayClose {
  at: Date
  source: DayCloseSource
  /** True for everything but `"hours"` — the ruled midnight fallback fired. */
  isFallback: boolean
}

// ─── Zoned instants, hand-rolled on Intl ─────────────────────────────────────
// There is no date-fns-tz in this repo (package.json) and this phase adds no
// dependency, so zoned construction extends the `localDateStr` idiom at
// src/lib/reports.ts:51-54. That module cannot be imported here: it pulls in the
// Prisma runtime, and this file has to stay usable from a client component. The
// date-string arithmetic below is therefore the same three lines as
// `nextDateStr` there, generalised to ±n days — a duplicated CALCULATION, not a
// duplicated RULE, which is the line DEBT-26 draws.

/** "YYYY-MM-DD" shifted by whole days. Pure calendar arithmetic, no timezone. */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 0 Sun … 6 Sat for a "YYYY-MM-DD". Calendar arithmetic, timezone-free — the
 *  store-local date already carries the store's day. */
export function jsDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()
}

/** Parse "HH:MM" (24-hour, the format the CHK-2 editor writes and <input
 *  type="time"> emits). Returns null for absent or malformed. */
function parseHhMm(value: string | null | undefined): { h: number; m: number } | null {
  if (typeof value !== "string") return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null
}

/** The wall-clock time in `timeZone` at `instant`, expressed as UTC ms. */
function wallMs(instant: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(instant))) p[part.type] = part.value
  // hour12:false yields "24" for midnight in some ICU versions.
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second))
}

/**
 * The instant at which the wall clock in `timeZone` reads `dateStr` `timeStr`.
 *
 * DST IS HANDLED EXPLICITLY AND THE CHOICES ARE STATED, because both of them
 * produce a close that looks an hour "wrong" twice a year and the first person
 * to see it should find the reason written down rather than file a bug:
 *
 *   SPRING FORWARD — a wall time that does not exist (02:30 on a US
 *   spring-forward Sunday). Neither candidate offset reads back as the
 *   requested time, so the LATER candidate is returned: the request is shifted
 *   FORWARD by the gap, landing at 03:30 local. Same rule as Temporal's
 *   "compatible" disambiguation. The close is an hour later than the clock
 *   suggests; the grace buffer absorbs it.
 *
 *   FALL BACK — a wall time that happens twice (01:30 on a US fall-back
 *   Sunday). Both candidates read back correctly, so the EARLIER one is
 *   returned (plan §3.5). The close fires an hour "early" relative to the second
 *   occurrence; the buffer absorbs that too.
 *
 * Resolution is deterministic in BOTH hemispheres and for zones on either side
 * of UTC, which a naive two-pass fixed point is not: the two candidate offsets
 * are probed a full day either side of the naive instant, so they straddle any
 * single transition regardless of its sign.
 */
export function zonedInstant(dateStr: string, timeStr: string, timeZone: string): Date | null {
  const hm = parseHhMm(timeStr)
  if (!hm) return null
  const [y, mo, d] = dateStr.split("-").map(Number)
  if (!y || !mo || !d) return null

  const naive = Date.UTC(y, mo - 1, d, hm.h, hm.m)
  const offsetBefore = wallMs(naive - DAY_MS, timeZone) - (naive - DAY_MS)
  const offsetAfter = wallMs(naive + DAY_MS, timeZone) - (naive + DAY_MS)

  const candidates = offsetBefore === offsetAfter ? [naive - offsetBefore] : [naive - offsetBefore, naive - offsetAfter]
  const valid = candidates.filter((c) => wallMs(c, timeZone) === naive)
  return new Date(valid.length ? Math.min(...valid) : Math.max(...candidates))
}

// ─── Store hours, read once, the disagreement recorded ───────────────────────
//
// THIS IS THE SINGLE DEFINITION SITE FOR HOW DAY CLOSE READS StoreHours, AND IT
// IS ALSO WHERE THE DISAGREEMENT WITH LABOR IS RECORDED — so that the two
// subsystems' different answers are a written fact rather than a discovery.
//
//   OVERNIGHT (closingTime <= openingTime, e.g. 07:00–02:00). Day close reads
//   it as a real window whose close instant falls on D+1, detected by comparing
//   the two strings and never by date arithmetic. LABOR DOES THE OPPOSITE:
//   src/lib/labor-plan.ts:202 accepts an explicit window only when `e > s`, so
//   the same store silently falls through to sales inference there.
//
//   ONE-SIDED (an opening time with no closing time, or the reverse — both are
//   legal, and CHK-2's editor allows them deliberately because inventing the
//   missing half is what DEBT-59 forbids). Day close uses whichever anchor it
//   has and falls back to midnight + buffer when the one it needs is missing.
//   Labor fails these identically to the overnight case.
//
// SO ONE STORE CAN BE JUDGED ON ITS REAL WINDOW BY DAY CLOSE AND ON AN INFERRED
// ONE BY LABOR. THAT IS **DEBT-64**, AND FIXING IT IS NOT CHK-3's — the fix is
// in labor-plan.ts, which this session must not touch. Nor is "aligning" the two
// by copying labor's `e > s` check into this file: that would make an overnight
// store unrepresentable to day close as well, which is a regression wearing a
// consistency argument's clothes.

/** The `StoreHours` row for a store-local date, or null. Duplicate rows for one
 *  weekday were possible before Migration B's unique index; the LOWEST
 *  dayOfWeek match in the order given wins, which is what both existing
 *  `.find()` readers already did — stated rather than left to chance. */
export function hoursForDate(hours: HoursRow[], dateStr: string): HoursRow | null {
  const dow = jsDayOfWeek(dateStr)
  return hours.find((h) => h.dayOfWeek === dow) ?? null
}

/**
 * The instant a store-local business day is CLOSED for checklist purposes:
 * store close + `DAY_CLOSE_GRACE_HOURS`, or store-local midnight + the same
 * buffer when there is no usable closing time (plan §3.1, ruled option (ii)).
 *
 * "Store-local midnight" is the END of the day — 00:00 on D+1 — so the fallback
 * close lands at 03:00 local on the following day.
 */
export function dayCloseInstant(hoursRow: HoursRow | null, dateStr: string, timeZone: string): DayClose {
  const midnight = () => {
    const at = zonedInstant(shiftDateStr(dateStr, 1), "00:00", timeZone)
    // zonedInstant only returns null for a malformed date or time, and both are
    // literals here; the fallback keeps the return type honest without inventing
    // an error path no caller can hit.
    return new Date((at?.getTime() ?? Date.UTC(0, 0, 1)) + DAY_CLOSE_GRACE_HOURS * HOUR_MS)
  }

  if (!hoursRow) return { at: midnight(), source: "no-hours", isFallback: true }
  if (hoursRow.isClosed) return { at: midnight(), source: "closed-day", isFallback: true }

  const closeStr = hoursRow.closingTime?.trim() ?? ""
  const openStr = hoursRow.openingTime?.trim() ?? ""
  if (!parseHhMm(closeStr)) return { at: midnight(), source: "no-close-time", isFallback: true }

  // OVERNIGHT: a close at or before the open belongs to the NEXT calendar day.
  // String comparison on "HH:MM", never date arithmetic. With no opening time
  // there is nothing to compare against, so the close is read as same-day — the
  // honest reading of a one-sided row, and the reason the one-sided case is
  // named in the block above.
  const closeDay = parseHhMm(openStr) && closeStr <= openStr ? shiftDateStr(dateStr, 1) : dateStr
  const at = zonedInstant(closeDay, closeStr, timeZone)
  if (!at) return { at: midnight(), source: "no-close-time", isFallback: true }
  return { at: new Date(at.getTime() + DAY_CLOSE_GRACE_HOURS * HOUR_MS), source: "hours", isFallback: false }
}

// ─── The expected window ─────────────────────────────────────────────────────

/**
 * The phase this template's window is anchored to, or null.
 *
 * `normalizePhase()` FIRST, then the canonical list — so this reader gets the
 * trim and the one I-14b legacy alias ("During Hours" → "During the Day") for
 * free, rather than silently giving a legacy row no expected window at all.
 * DEBT-1b's backfill means such a row should not exist on any branch; reading
 * through the same normaliser every write path uses means it does not matter if
 * one does.
 *
 * This is the FOURTH reader DEBT-32 was folded for (phases.ts says so) and it
 * reads that one list. A hand-copied list here would undo the fold in the
 * session immediately after it.
 *
 * Note the difference from `phaseOrder()`, which deliberately does NOT
 * normalize: that function replaced two live implementations and had to return
 * exactly what they returned, whitespace included. This one is new and has no
 * behaviour to preserve, so it can simply be right.
 */
function windowPhase(value: string | null): OperationalPhase | null {
  const normalized = normalizePhase(value)
  return normalized !== null && (OPERATIONAL_PHASES as readonly string[]).includes(normalized)
    ? (normalized as OperationalPhase)
    : null
}

/**
 * The window a checklist is EXPECTED to be done in, for one store-local day.
 * Never a gate — nothing is hidden and nothing is blocked by it (Gary's R3).
 *
 * Returns null when there is no expected window at all: `availabilityType` is
 * `AllDay`, `operationalPhase` is absent or unrecognised, the store is closed
 * that weekday, both offsets are blank, or neither anchor the phase needs
 * exists. Null and `{start: null, end: null}` would mean the same thing to every
 * predicate, so there is ONE representation of "no window" and it is null.
 *
 * EACH SIDE IS INDEPENDENT — NO BOTH-OR-NEITHER RULE (plan §4, §12.6).
 * `startOffsetHours` governs *upcoming*; blank means active from the start of
 * the day. `endOffsetHours` governs *overdue*; blank means this checklist can
 * NEVER be overdue — only completed, or missed at day close. A both-or-neither
 * rule would either block saves (regressing DEBT-59's optionality) or invent the
 * missing half.
 *
 * Anchors, per the labels the template form has always shown (plan §1.3):
 *   Before Opening   start = opening − startOffset   end = opening + endOffset
 *   During the Day   start = opening + startOffset   end = closing − endOffset
 *   After Closing    start = closing − startOffset   end = closing + endOffset
 *
 * BOTH SIDES ARE CLAMPED TO DAY CLOSE (plan §3.5, §12.10). Without it an
 * `After Closing` template with an end offset larger than the grace buffer would
 * be recorded Missed while still inside its own expected window. The form
 * warning that tells the operator this happened is CHK-4's half.
 *
 * A window whose start lands after its end (possible only from offsets that
 * cross their own anchors) is left exactly as computed. It is the operator's
 * window, `checklistState` resolves it deterministically — overdue outranks
 * upcoming — and inventing an ordering rule here would be the both-or-neither
 * mistake in a different costume.
 */
export function expectedWindow(
  template: WindowTemplate,
  hoursRow: HoursRow | null,
  dateStr: string,
  timeZone: string
): ExpectedWindow | null {
  const raw = rawWindow(template, hoursRow, dateStr, timeZone)
  if (!raw) return null
  const dayClose = dayCloseInstant(hoursRow, dateStr, timeZone).at.getTime()
  const clamp = (d: Date | null) => (d && d.getTime() > dayClose ? new Date(dayClose) : d)
  return { start: clamp(raw.start), end: clamp(raw.end) }
}

/**
 * The window BEFORE the clamp. Split out of `expectedWindow` by CHK-4's
 * close-out so that `endClampsAtDayClose` can ask "would this have been cut?"
 * without a second copy of the anchor rules — the clamp is the only thing that
 * erases the evidence of itself, so the question is unanswerable from the
 * clamped result alone. Behaviour of `expectedWindow` is unchanged: it is the
 * same body with the last three lines lifted out.
 *
 * NOT EXPORTED. A raw window is not a fact about the product — the engine and
 * every surface read the clamped one, and a second exported window function is
 * exactly how two definitions of "expected" start to drift.
 */
function rawWindow(
  template: WindowTemplate,
  hoursRow: HoursRow | null,
  dateStr: string,
  timeZone: string
): ExpectedWindow | null {
  if (template.availabilityType === "AllDay") return null
  const phase = windowPhase(template.operationalPhase)
  if (phase === null) return null
  if (template.startOffsetHours == null && template.endOffsetHours == null) return null
  if (!hoursRow || hoursRow.isClosed) return null

  // Anchors. Either may be null — a one-sided row is legal, and the side it
  // lacks simply produces no expectation rather than an invented one.
  const openStr = hoursRow.openingTime?.trim() ?? ""
  const closeStr = hoursRow.closingTime?.trim() ?? ""
  const openAt = zonedInstant(dateStr, openStr, timeZone)
  const overnight = parseHhMm(openStr) != null && parseHhMm(closeStr) != null && closeStr <= openStr
  const closeAt = zonedInstant(overnight ? shiftDateStr(dateStr, 1) : dateStr, closeStr, timeZone)

  const shift = (anchor: Date | null, hours: number | null, sign: 1 | -1): Date | null =>
    anchor && hours != null ? new Date(anchor.getTime() + sign * hours * HOUR_MS) : null

  let start: Date | null = null
  let end: Date | null = null
  switch (phase) {
    case "Before Opening":
      start = shift(openAt, template.startOffsetHours, -1)
      end = shift(openAt, template.endOffsetHours, 1)
      break
    case "During the Day":
      start = shift(openAt, template.startOffsetHours, 1)
      end = shift(closeAt, template.endOffsetHours, -1)
      break
    case "After Closing":
      start = shift(closeAt, template.startOffsetHours, -1)
      end = shift(closeAt, template.endOffsetHours, 1)
      break
  }

  if (!start && !end) return null
  return { start, end }
}

/**
 * Would this template's END be cut short by day close, for this store on this
 * weekday? CHK-4 close-out, 2026-08-10 — the predicate behind the template
 * form's clamp warning (plan §12, S4 item 7).
 *
 * IT LIVES HERE BECAUSE THE CLAMP LIVES HERE. The form's first attempt at this
 * warning answered it with arithmetic of its own — endOffset > the grace buffer
 * — which is true only for `After Closing` and therefore silent for the case
 * that was measured on staging (`Before Opening`, Ends = 20, a store open 07:00
 * to 17:00). Any form-side re-derivation has that shape: it is DEBT-26's second
 * definition site, and the second site is the one that is wrong.
 *
 * FALSE, not true, when there is nothing to compare — no hours row, a closed
 * weekday, no end offset, an `AllDay` template. `rawWindow` already returns null
 * for each of those, and a warning about a store the operator has not described
 * yet would be noise. The form's explainer states the clamp unconditionally,
 * which is what covers the undescribed store.
 */
export function endClampsAtDayClose(
  template: WindowTemplate,
  hoursRow: HoursRow | null,
  dateStr: string,
  timeZone: string
): boolean {
  const raw = rawWindow(template, hoursRow, dateStr, timeZone)
  if (!raw?.end) return false
  return raw.end.getTime() > dayCloseInstant(hoursRow, dateStr, timeZone).at.getTime()
}

// ─── The five predicates, stated once ────────────────────────────────────────

/** An expected start exists and has not arrived. */
export function isUpcoming(window: ExpectedWindow | null, now: Date): boolean {
  return window?.start != null && now < window.start
}

/**
 * OVERDUE IS DERIVED, NEVER STORED. No column, no cron, no marker — it is
 * correct the instant an offset changes, and it corrects itself the instant the
 * day closes.
 *
 * `window.end != null` IS GARY'S R3 IN CODE: blank offsets mean no expected
 * window, and a checklist with no window end can never go overdue — only
 * completed, or missed at day close.
 */
export function isOverdue(checklist: LifecycleChecklist, window: ExpectedWindow | null, now: Date): boolean {
  return (
    window?.end != null &&
    now >= window.end &&
    checklist.closedAt == null &&
    checklist.status !== "Completed"
  )
}

/** Not upcoming, not overdue, not closed — the ordinary state of a checklist
 *  inside its day. */
export function isActive(checklist: LifecycleChecklist, window: ExpectedWindow | null, now: Date): boolean {
  if (checklist.closedAt != null || checklist.status === "Completed") return false
  return !isUpcoming(window, now) && !isOverdue(checklist, window, now)
}

/** A CLOSED FACT: the day ended and this checklist was not completed. Stored,
 *  because R1 makes it permanent — `closedAt` is written once, by the cron. */
export function isMissed(checklist: LifecycleChecklist): boolean {
  return checklist.closedAt != null && checklist.status !== "Completed"
}

/** Completed, but after its expected end. Stored (`completedLate`), written once
 *  by submit — never re-derived, so an offset edited afterwards cannot rewrite
 *  it. */
export function isCompletedLate(checklist: LifecycleChecklist): boolean {
  return checklist.completedLate === true
}

/**
 * The five folded into one answer. Precedence: a completed checklist is
 * completed however late it was; a closed one is missed; then the derived
 * states.
 */
export function checklistState(
  checklist: LifecycleChecklist,
  window: ExpectedWindow | null,
  now: Date
): ChecklistState {
  if (checklist.status === "Completed") return "completed"
  if (isMissed(checklist)) return "missed"
  if (isOverdue(checklist, window, now)) return "overdue"
  if (isUpcoming(window, now)) return "upcoming"
  return "active"
}

// ─── Day-close policy helpers ────────────────────────────────────────────────

/**
 * Whether day close MATERIALISES a Missed row for a template nobody started.
 *
 * DAILY ONLY, and the exclusion is engine-level (plan §5.4, §12.8).
 * `Template.frequency` is display-only — no generation path reads it, which is
 * **DEBT-61** — so a Weekly template already gets a checklist every day from
 * bulk generate and would be filed missed six days a week by an unfiltered job,
 * and a Monthly one ~29 times. That is a CONTAINMENT, not a fix: the fix is
 * frequency-aware generation (a day-of-week, a day-of-month, neither collected
 * today), and it is DEBT-61's, not this session's. CHK-5's report states the
 * exclusion on its face so "no weekly misses" is never read as "weekly
 * checklists were all done".
 *
 * A non-Daily template that WAS started still closes normally — only the
 * create-a-row-for-a-checklist-nobody-started step is skipped.
 */
export function materializesMisses(frequency: string | null | undefined): boolean {
  return (frequency ?? "Daily") === "Daily"
}

/**
 * Whether a completion counts as late. NULL EXPECTATIONS ARE NEVER LATE: a row
 * with no `expectedEndAt` recorded no expectation at all (blank offsets, AllDay,
 * no store hours, or a row predating Migration B), and treating that as on-time
 * or as late would both be inventing a judgement nobody made.
 */
export function isLateCompletion(expectedEndAt: Date | null, completedAt: Date): boolean {
  return expectedEndAt != null && completedAt > expectedEndAt
}
