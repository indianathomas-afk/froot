// ─────────────────────────────────────────────────────────────────────────────
// CAL-1 — THE PROJECTION ENGINE.
//
// Pure functions over "YYYY-MM-DD" strings. NO PRISMA IMPORT, for the same
// reason src/lib/checklist-lifecycle.ts has none: the month grid is a client
// component and must be able to import this. Conversion to and from Prisma
// `DateTime` happens at the route boundary, once in each direction.
//
// WHY STRINGS AND NOT `Date`. A calendar date is not an instant — the 15th is
// the 15th in every timezone — and CLAUDE.md § Database Evidence records that
// reading a UTC timestamp as a local one produced three wrong conclusions in a
// single day. There is no instant anywhere in the recurrence rules below, so
// there is nothing in them to misread. `dueAtFor()` at the bottom is the ONE
// function here that returns a real instant, and it is the only one that has to
// think about a timezone.
//
// CAL-2 WILL CALL projectDueDates() FOR TEMPLATES — a Weekly template needs a
// day-of-week and a Monthly one a day-of-month, which is DEBT-61's stated fix
// shape and exactly what a CalendarEvent's recurrence + startDate carry. So
// these functions are TEMPLATE-AGNOSTIC on purpose: they take a structural
// `ProjectableEvent`, never a Prisma CalendarEvent, and nothing in this file
// knows what a reminder is.
// ─────────────────────────────────────────────────────────────────────────────

import { dayCloseInstant, shiftDateStr, zonedInstant, type HoursRow } from "@/lib/checklist-lifecycle"

// ─── The fixed lists (ruling 7) ──────────────────────────────────────────────
//
// COLOUR IS BY CATEGORY, NEVER BY PRIORITY (ruling 7). Each category owns one
// token; the Critical flag is an icon and carries no colour of its own. The
// tokens are defined in globals.css beside the existing status colours.
export const CALENDAR_CATEGORIES = [
  { id: "ordering", label: "Ordering", token: "--color-cal-ordering" },
  { id: "cleaning", label: "Cleaning & Maintenance", token: "--color-cal-cleaning" },
  { id: "finance", label: "Finance", token: "--color-cal-finance" },
  { id: "storeops", label: "Store Ops", token: "--color-cal-storeops" },
  { id: "other", label: "Other", token: "--color-cal-other" },
] as const

export type CalendarCategoryId = (typeof CALENDAR_CATEGORIES)[number]["id"]

/** Ruling 6. Critical carries a flag; the other two do not. */
export const CALENDAR_PRIORITIES = ["Critical", "High", "Standard"] as const
export type CalendarPriority = (typeof CALENDAR_PRIORITIES)[number]

export const CALENDAR_RECURRENCES = ["None", "Daily", "Weekly", "Biweekly", "Monthly"] as const
export type CalendarRecurrence = (typeof CALENDAR_RECURRENCES)[number]

export const CALENDAR_STATUSES = ["Open", "Completed"] as const

/**
 * Canonical category id, or null for anything unregistered — THE phases.ts
 * PATTERN (src/lib/phases.ts:34), which trims and then checks membership rather
 * than trusting the caller.
 *
 * REJECTS BY NAME, which is the half that matters. A category that falls
 * through to "other" would render in the wrong colour forever and nothing would
 * ever look wrong; a null makes the route answer 400 with the value it refused.
 * Accepts the label as well as the id so an import path can hand over
 * "Cleaning & Maintenance" without every caller owning the mapping.
 */
export function normalizeCategory(value: string | null | undefined): CalendarCategoryId | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const byId = CALENDAR_CATEGORIES.find((c) => c.id === trimmed.toLowerCase())
  if (byId) return byId.id
  const byLabel = CALENDAR_CATEGORIES.find((c) => c.label.toLowerCase() === trimmed.toLowerCase())
  return byLabel ? byLabel.id : null
}

export function normalizePriority(value: string | null | undefined): CalendarPriority | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return (CALENDAR_PRIORITIES as readonly string[]).includes(trimmed) ? (trimmed as CalendarPriority) : null
}

export function normalizeRecurrence(value: string | null | undefined): CalendarRecurrence | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return (CALENDAR_RECURRENCES as readonly string[]).includes(trimmed) ? (trimmed as CalendarRecurrence) : null
}

/** The colour token for a category, falling back to Other's — a RENDER-time
 *  fallback only. Nothing is ever STORED unnormalised: normalizeCategory()
 *  refuses at the write path, so this fallback is unreachable for any row this
 *  app wrote. It exists so a hand-edited row renders as something rather than
 *  as a blank swatch. (The CHK-4 `?? STATUS_STYLES.Pending` argument exactly:
 *  map every value you write, and keep the net for the next one somebody adds.) */
export function categoryToken(categoryId: string): string {
  return (CALENDAR_CATEGORIES.find((c) => c.id === categoryId) ?? CALENDAR_CATEGORIES[4]).token
}

export function categoryLabel(categoryId: string): string {
  return (CALENDAR_CATEGORIES.find((c) => c.id === categoryId) ?? CALENDAR_CATEGORIES[4]).label
}

// ─── Projection ──────────────────────────────────────────────────────────────

/** Everything the recurrence rules need and nothing else. Structural so CAL-2
 *  can pass a Template-shaped object without this module learning about
 *  templates. */
export type ProjectableEvent = {
  recurrence: string
  /** "YYYY-MM-DD", store-local calendar date. */
  startDate: string
  /** "YYYY-MM-DD" inclusive, or null for open-ended. */
  endDate: string | null
}

/** Whole days between two "YYYY-MM-DD", b - a. Calendar arithmetic, no zone —
 *  both dates are already store-local days. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)
  return Math.round(ms / 86_400_000)
}

function isValidDateStr(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00.000Z`)
  if (Number.isNaN(t)) return false
  // Rejects 2026-02-30, which Date.parse would otherwise roll into March.
  return new Date(t).toISOString().slice(0, 10) === value
}

/** Day-of-month, clamped to that month's last day. The 31st becomes Feb 28 (29
 *  in a leap year) and Apr 30, and RETURNS TO THE 31ST in May — the clamp is
 *  applied per month against the original day, never carried forward, so a long
 *  month is not permanently shortened by a short one before it. */
function clampedMonthDate(year: number, monthIndex0: number, dayOfMonth: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
  const d = Math.min(dayOfMonth, lastDay)
  return new Date(Date.UTC(year, monthIndex0, d)).toISOString().slice(0, 10)
}

/**
 * Every date this event falls due within [fromDate, toDate], inclusive both
 * ends, ascending.
 *
 * NOTHING BEFORE `startDate` IS EVER EMITTED and nothing after `endDate` when
 * one is set — both bounds are applied AFTER the rule rather than inside it, so
 * a rule cannot quietly disagree with them.
 *
 * WEEKLY / BIWEEKLY ARE ANCHORED TO `startDate`, NOT TO THE WINDOW. The phase
 * is a property of the event: a biweekly event viewed from next month must land
 * on the same dates it would have if you had scrolled there from this one.
 * Deriving the phase from `fromDate` is the obvious shortcut and it makes the
 * grid disagree with itself between two scroll positions.
 */
export function projectDueDates(event: ProjectableEvent, fromDate: string, toDate: string): string[] {
  if (!isValidDateStr(event.startDate) || !isValidDateStr(fromDate) || !isValidDateStr(toDate)) return []
  if (event.endDate !== null && !isValidDateStr(event.endDate)) return []
  if (toDate < fromDate) return []

  // The effective window: never before the event starts, never after it ends.
  const lo = fromDate > event.startDate ? fromDate : event.startDate
  const hi = event.endDate !== null && event.endDate < toDate ? event.endDate : toDate
  if (hi < lo) return []

  const out: string[] = []

  switch (normalizeRecurrence(event.recurrence)) {
    case "None": {
      // A one-off falls due exactly once, on its start date.
      if (event.startDate >= lo && event.startDate <= hi) out.push(event.startDate)
      break
    }
    case "Daily": {
      for (let d = lo; d <= hi; d = shiftDateStr(d, 1)) out.push(d)
      break
    }
    case "Weekly":
    case "Biweekly": {
      const step = normalizeRecurrence(event.recurrence) === "Weekly" ? 7 : 14
      // Jump straight to the first on-phase date at or after `lo` instead of
      // walking from startDate — a 2019 event viewed today would otherwise be
      // hundreds of iterations of nothing.
      const elapsed = daysBetween(event.startDate, lo)
      const offset = elapsed <= 0 ? 0 : (step - (elapsed % step)) % step
      for (let d = shiftDateStr(lo, offset); d <= hi; d = shiftDateStr(d, step)) out.push(d)
      break
    }
    case "Monthly": {
      const [sy, sm, sd] = event.startDate.split("-").map(Number)
      const dayOfMonth = sd!
      // Start one month early so a clamp landing before `lo` is still tested,
      // and walk month by month rather than by days.
      let y = Number(lo.slice(0, 4))
      let m = Number(lo.slice(5, 7)) - 1
      if (y < sy! || (y === sy! && m < sm! - 1)) {
        y = sy!
        m = sm! - 1
      }
      for (let guard = 0; guard < 480; guard++) {
        const candidate = clampedMonthDate(y, m, dayOfMonth)
        if (candidate > hi) break
        if (candidate >= lo) out.push(candidate)
        m += 1
        if (m > 11) {
          m = 0
          y += 1
        }
      }
      break
    }
    default:
      // An unregistered recurrence projects NOTHING rather than guessing at
      // Daily. Deny by default, the same rule permissions.ts opens with.
      return []
  }

  return out
}

/**
 * The first date this event falls due strictly AFTER `afterDate`, or its
 * `startDate` when `afterDate` is null (nothing has been completed yet), or
 * null when the event has ended.
 *
 * STRICTLY AFTER IS THE WHOLE POINT. The cron passes the due date of the last
 * COMPLETED occurrence; an at-or-after reading would hand back the date that
 * was just completed and materialise it again the same hour, forever.
 *
 * BOUNDED, NEVER AN OPEN LOOP: it projects a finite window forward and takes
 * the head, widening twice before giving up. A Monthly event whose next date is
 * eleven months out is found on the second widening; anything beyond that is an
 * event that has effectively ended.
 */
export function nextDueDate(event: ProjectableEvent, afterDate: string | null): string | null {
  if (!isValidDateStr(event.startDate)) return null
  if (afterDate === null) {
    if (event.endDate !== null && event.startDate > event.endDate) return null
    return event.startDate
  }
  if (!isValidDateStr(afterDate)) return null

  const from = shiftDateStr(afterDate, 1)
  for (const span of [45, 400, 1200]) {
    const hits = projectDueDates(event, from, shiftDateStr(from, span))
    if (hits.length > 0) return hits[0]!
  }
  return null
}

// ─── Ruling 8 — when a reminder becomes overdue ──────────────────────────────

/**
 * The instant a reminder due on `dueDate` at `store` becomes OVERDUE.
 *
 * Ruling 8, in order: the explicit `dueTime` if one is set; otherwise store
 * close on the due date; otherwise — no hours, a closed day, or an unparseable
 * closing time — the END of the store's local day, which is midnight.
 *
 * `graceHours: 0` IS THE POINT OF R3. dayCloseInstant() adds
 * DAY_CLOSE_GRACE_HOURS (3) by default, because a checklist's day close is
 * deliberately forgiving — the floor gets three hours past close to finish. A
 * reminder is not forgiving in that way: ruling 8 says overdue begins AT close,
 * and at the END of the local day (00:00 on D+1) for a store with no hours, not
 * at 03:00 the following morning.
 *
 * READ THROUGH THE ENGINE, NEVER FORKED. Every fallback — closed day, no hours
 * row, one-sided row, overnight close — is dayCloseInstant()'s answer, so a
 * store whose day CHK-3 ends at one instant cannot have its reminders judged
 * against a different one.
 */
export function dueAtFor(
  store: { timezone: string },
  hoursRow: HoursRow | null,
  dueDate: string,
  dueTime: string | null
): Date {
  if (dueTime) {
    const at = zonedInstant(dueDate, dueTime, store.timezone)
    // A malformed dueTime falls through to store close rather than throwing:
    // the column is validated on write, so this is the unreachable-but-honest
    // branch, and the wrong answer to give here is a crash in a cron.
    if (at) return at
  }
  return dayCloseInstant(hoursRow, dueDate, store.timezone, 0).at
}

/** Whole days an occurrence is overdue at `now`, or 0 if it is not yet overdue.
 *  The banner's "N days overdue" (B7) — one definition, because the banner and
 *  any later report must not each round it their own way. Counts ELAPSED whole
 *  days, so an occurrence two hours past its dueAt is 0 days overdue and reads
 *  as simply "due" rather than "0 days overdue". */
export function daysOverdue(dueAt: Date, now: Date): number {
  const ms = now.getTime() - dueAt.getTime()
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000)
}
