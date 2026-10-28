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

/** DOC-7: calendar months on a "YYYY-MM-DD", clamped to the target month's
 *  last day (date-fns' rule): Jan 31 + 6 → Jul 31, Aug 31 + 6 → Feb 28/29,
 *  Feb 29 + 12 → Feb 28. No zone: the input is already a local day. */
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = index - year * 12 // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
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

// ─────────────────────────────────────────────────────────────────────────────
// MS-4a — CHECKLIST MILESTONE MATH. Pure, like tenureProgress above.
//
// F0 (Gary, 2026-10-17): "Count TASKS where the person is named (not whole
// checklists). Thresholds therefore mean "N tasks completed"." The caller hands
// in the store-local date of every TaskLog naming the member, oldest first; the
// count is its length and milestone N is reached on the date of the Nth.
//
// THE COUNT CAN GO DOWN. Un-ticking a task deletes its TaskLog
// (api/checklists/[id]/task-log), so an achieved milestone can un-achieve. The
// tab shows the live count; nothing is stored.
// ─────────────────────────────────────────────────────────────────────────────

/** The editable fields of a ChecklistMilestone — POST, and PATCH .partial(). */
export const checklistFieldsSchema = z.object({
  taskCount: z.number().int().min(1).max(1_000_000),
  title: z.string().trim().min(1).max(120),
  recognition: z.string().trim().max(4000),
  employeeMessage: z.string().trim().max(4000),
})

export type ChecklistMilestoneInput = {
  id: string
  taskCount: number
  title: string
  recognition: string
  employeeMessage: string
  /** Same meaning as TenureMilestoneInput.archivedOn. */
  archivedOn?: string | null
  isArchived?: boolean
}

export type AchievedChecklistMilestone = ChecklistMilestoneInput & {
  /** Store-local date of the member's Nth named task. */
  achievedOn: string
  archived: boolean
}

export type ChecklistProgress = {
  tasksCompleted: number
  terminated: boolean
  /** Oldest first. */
  achieved: AchievedChecklistMilestone[]
  /** Null when every milestone is reached, when there are none, and for a
   *  terminated member (the tenure F4 rule, applied the same way). */
  next: (ChecklistMilestoneInput & { tasksToGo: number }) | null
  progressPct: number | null
}

/**
 * Where a member stands against the org's checklist milestones. The caller
 * passes ACTIVE AND ARCHIVED rows; the archived rule is tenureProgress's: kept
 * in history when reached on or before its archive date, never reached after,
 * never "next".
 */
export function checklistProgress(args: {
  /** Store-local "YYYY-MM-DD" of each named task, oldest first. */
  taskDates: string[]
  terminated: boolean
  milestones: ChecklistMilestoneInput[]
}): ChecklistProgress {
  const { taskDates, terminated } = args
  const count = taskDates.length
  const sorted = [...args.milestones].sort((a, b) => a.taskCount - b.taskCount)
  const isArchived = (m: ChecklistMilestoneInput) => m.isArchived === true || !!m.archivedOn

  const achieved: AchievedChecklistMilestone[] = []
  for (const m of sorted) {
    if (m.taskCount > count) continue
    const achievedOn = taskDates[m.taskCount - 1]
    if (isArchived(m) && !(m.archivedOn && achievedOn <= m.archivedOn)) continue
    achieved.push({ ...m, achievedOn, archived: isArchived(m) })
  }

  const active = sorted.filter((m) => !isArchived(m))
  const upcoming = terminated ? undefined : active.find((m) => m.taskCount > count)
  const next = upcoming ? { ...upcoming, tasksToGo: upcoming.taskCount - count } : null

  let progressPct: number | null = null
  if (next) {
    const passed = active.filter((m) => m.taskCount <= count)
    const from = passed.length > 0 ? passed[passed.length - 1].taskCount : 0
    const span = next.taskCount - from
    progressPct = span > 0 ? Math.min(100, Math.max(0, Math.round(((count - from) / span) * 100))) : 0
  }

  return { tasksCompleted: count, terminated, achieved, next, progressPct }
}

/** "1 task", "250 tasks". */
export function taskCountLabel(taskCount: number): string {
  return `${taskCount.toLocaleString("en-US")} task${taskCount === 1 ? "" : "s"}`
}
