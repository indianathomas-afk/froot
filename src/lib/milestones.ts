// ─────────────────────────────────────────────────────────────────────────────
// MS-1 — TENURE MILESTONE MATH. Pure: no database, no clock, no timezone.
//
// EVERY DATE HERE IS A STORE-LOCAL "YYYY-MM-DD" STRING, and the caller resolves
// it — the CAL-2a rule (src/app/api/calendar/due/route.ts): `today` is
// localDateStr(now, displayTimeZone(member, org)), never the server's date and
// never a UTC slice of an instant. The DB is UTC and the stores are Pacific;
// between 17:00 and 24:00 PDT those disagree about what day it is, and a
// milestone would be announced a day early on every evening shift.
//
// THERE IS NO "ACHIEVED" TABLE. Achieved is a pure function of
// (startDate, dayCount, asOf), so a start-date correction re-flows instantly
// and there is nothing stored to drift out of agreement with it.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod"

/** The editable fields of a TenureMilestone — shared by POST and PATCH (which
 *  takes it .partial()). dayCount > 0 is the schema note's rule. */
export const tenureFieldsSchema = z.object({
  dayCount: z.number().int().min(1).max(36500),
  title: z.string().trim().min(1).max(120),
  recognition: z.string().trim().max(4000),
  employeeMessage: z.string().trim().max(4000),
})

export type TenureMilestoneInput = {
  id: string
  dayCount: number
  title: string
  recognition: string
  employeeMessage: string
  /** Store-local date the milestone was archived; null/absent = active. An
   *  ARCHIVED row passed here with archivedOn null is treated as never
   *  reachable (no date to judge history against). */
  archivedOn?: string | null
  isArchived?: boolean
}

export type AchievedMilestone = TenureMilestoneInput & {
  /** The store-local date the milestone fell on: startDate + dayCount. */
  achievedOn: string
  /** Reached before the milestone was archived — kept as history. */
  archived: boolean
}

export type NextMilestone = TenureMilestoneInput & {
  daysToGo: number
  dueOn: string
}

export type TenureProgress =
  | { state: "no-start-date" }
  | {
      state: "ok"
      /** Whole calendar days from startDate to asOf. Negative when the start
       *  date is in the future (a hire entered ahead of their first day). */
      daysEmployed: number
      /** The date the count runs to: today, or the termination date (F4). */
      asOf: string
      terminated: boolean
      /** Oldest first. */
      achieved: AchievedMilestone[]
      /** Null when every milestone is achieved, when there are none, and ALWAYS
       *  for a terminated member — F4: no "next milestone" after they leave. */
      next: NextMilestone | null
      /** 0–100: progress from the previous milestone (or the start date) to the
       *  next one. Null when there is no next. */
      progressPct: number | null
    }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar date in "YYYY-MM-DD" form. Rejects 2026-02-30,
 *  which Date.parse would otherwise roll into March. */
export function isValidDateStr(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const t = Date.parse(`${value}T00:00:00.000Z`)
  if (Number.isNaN(t)) return false
  return new Date(t).toISOString().slice(0, 10) === value
}

/** A @db.Date column comes back as UTC midnight of that date, so the UTC slice
 *  IS the date. Only valid for @db.Date values — never for a TIMESTAMP. */
export function dateColumnStr(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** Whole calendar days b − a. No zone: both are already store-local days. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)
  return Math.round(ms / 86_400_000)
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Where a member stands against the org's tenure milestones. The caller passes
 * ACTIVE AND ARCHIVED rows.
 *
 * ARCHIVED MILESTONES (Gary, 2026-10-15: "Past achievements should stay on
 * record"). An archived milestone stays in a member's achieved list when they
 * reached it ON OR BEFORE the store-local date it was archived, and is shown as
 * archived. Nobody reaches it after that date, and it is never the "next"
 * milestone. An archived row with no archive date counts for nobody.
 *
 * F4 (Gary, 2026-10-15): a terminated member's count stops at their
 * termination date and they have no next milestone. A REHIRE clears
 * terminatedAt, so the count runs straight through the gap from the stored
 * start date until an ADMIN edits it — ruled, not an oversight.
 */
export function tenureProgress(args: {
  startDate: string | null
  today: string
  /** Store-local termination date, or null when ACTIVE. */
  terminatedOn: string | null
  milestones: TenureMilestoneInput[]
}): TenureProgress {
  const { startDate, today, terminatedOn } = args
  if (!startDate) return { state: "no-start-date" }

  const terminated = terminatedOn !== null
  const asOf = terminated && terminatedOn < today ? terminatedOn : today
  const daysEmployed = daysBetween(startDate, asOf)

  const sorted = [...args.milestones].sort((a, b) => a.dayCount - b.dayCount)
  const isArchived = (m: TenureMilestoneInput) => m.isArchived === true || !!m.archivedOn
  const achieved: AchievedMilestone[] = []
  for (const m of sorted) {
    if (m.dayCount > daysEmployed) continue
    const achievedOn = addDays(startDate, m.dayCount)
    if (isArchived(m) && !(m.archivedOn && achievedOn <= m.archivedOn)) continue
    achieved.push({ ...m, achievedOn, archived: isArchived(m) })
  }

  const active = sorted.filter((m) => !isArchived(m))
  const upcoming = terminated ? undefined : active.find((m) => m.dayCount > daysEmployed)
  const next: NextMilestone | null = upcoming
    ? { ...upcoming, daysToGo: upcoming.dayCount - daysEmployed, dueOn: addDays(startDate, upcoming.dayCount) }
    : null

  let progressPct: number | null = null
  if (next) {
    // Progress runs from the last ACTIVE milestone already passed.
    const passed = active.filter((m) => m.dayCount <= daysEmployed)
    const from = passed.length > 0 ? passed[passed.length - 1].dayCount : 0
    const span = next.dayCount - from
    const done = Math.max(0, daysEmployed - from)
    progressPct = span > 0 ? Math.min(100, Math.max(0, Math.round((done / span) * 100))) : 0
  }

  return { state: "ok", daysEmployed, asOf, terminated, achieved, next, progressPct }
}

/** Human tenure label for a day count: "90 days", "1 year", "18 months"… Used
 *  on the setup list and the tab so a dayCount never renders as a bare number. */
export function dayCountLabel(dayCount: number): string {
  if (dayCount % 365 === 0) {
    const y = dayCount / 365
    return `${y} year${y === 1 ? "" : "s"}`
  }
  return `${dayCount} day${dayCount === 1 ? "" : "s"}`
}
