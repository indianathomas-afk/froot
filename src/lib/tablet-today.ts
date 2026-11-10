import type { ChecklistState } from "@/lib/checklist-lifecycle"

// TAB-1 — WHICH CHECKLIST THE TABLET'S TASKS PANEL SHOWS.
//
// Audit point 3 found NO existing "current checklist" rule to reuse. The SET of
// a store's checklists today already has one owner — GET
// /api/stores/[id]/templates, the list behind Start Daily Checklist, which
// applies the template's store scope and frequency and drops Missed rows — and
// the tablet reads that list rather than re-deriving it. What did not exist is
// a rule for picking ONE of them, so this is new code, and it is the prompt's
// lean as applied (docs/DECISIONS.md, TAB-1 draft):
//
//   1. CURRENT = the earliest-due checklist that is due now and not completed
//      (lifecycle `active` or `overdue`). "Earliest-due" is expectedEndAt
//      ascending; a checklist with no window sorts after every windowed one;
//      name breaks ties.
//   2. Nothing due now, but something was completed today → DONE, showing the
//      latest-due completed checklist, with the earliest `upcoming` one as
//      "up next" (null when there is none).
//   3. Nothing due now and nothing completed, but something upcoming → that
//      upcoming checklist is CURRENT (a crew in before the window opens can
//      still start it — Start Daily Checklist does not block it either).
//   4. Nothing at all → NONE.
//
// Rule 2 is the reading that makes the lean's "Done with the next upcoming
// checklist" reachable: an upcoming checklist is not yet due, so it does not
// hold the panel open after the current one is finished.
//
// Pure — no Prisma, no React — so scripts/verify-tab1-today.ts pins it.

export interface TodayEntry {
  /** Template id — the key the Start Daily Checklist list uses. */
  id: string
  name: string
  /** Today's Checklist row, or null when nothing has instantiated it yet. */
  existingChecklistId: string | null
  lifecycleState: ChecklistState
  /** ISO instant, or null for a checklist with no expected window. */
  expectedEndAt: string | null
}

export type TodayPick<T extends TodayEntry> =
  | { mode: "current"; current: T }
  | { mode: "done"; lastDone: T; upNext: T | null }
  | { mode: "none" }

function byDue<T extends TodayEntry>(a: T, b: T): number {
  if (a.expectedEndAt !== b.expectedEndAt) {
    if (a.expectedEndAt === null) return 1
    if (b.expectedEndAt === null) return -1
    return a.expectedEndAt < b.expectedEndAt ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

export function pickTodayChecklist<T extends TodayEntry>(entries: T[]): TodayPick<T> {
  const sorted = [...entries].sort(byDue)
  const dueNow = sorted.filter((e) => e.lifecycleState === "active" || e.lifecycleState === "overdue")
  if (dueNow.length > 0) return { mode: "current", current: dueNow[0] }

  const completed = sorted.filter((e) => e.lifecycleState === "completed")
  const upcoming = sorted.filter((e) => e.lifecycleState === "upcoming")
  if (completed.length > 0) {
    return { mode: "done", lastDone: completed[completed.length - 1], upNext: upcoming[0] ?? null }
  }
  if (upcoming.length > 0) return { mode: "current", current: upcoming[0] }
  return { mode: "none" }
}
