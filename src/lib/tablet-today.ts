import type { ChecklistState } from "@/lib/checklist-lifecycle"
import { formatWindowTime } from "@/lib/checklist-status-display"

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

// ─── TAB-13 — the checklist switcher on the hero ─────────────────────────────
//
// TAB-13 puts EVERY checklist of the day in a tab row above the hero, so the
// rule is no longer "which one to show" but "in what order, and which first".
// R3 as amended by RN-3 (Gary, 2026-11-11, "Ratify as recommended"):
//
//   0. IN PROGRESS (started, not completed)          — earliest due first
//   1. NOT STARTED and due now (`active` / `overdue`) — earliest due first
//   2. NOT STARTED and `upcoming` (window not open)   — earliest due first
//   3. COMPLETED
//
// "Earliest due" is byDue above, unchanged: expectedEndAt ascending, no window
// after every windowed one, name as the tie-break. MISSED IS DROPPED, exactly
// as pickTodayChecklist drops it (it matches none of its branches) and as the
// source route already drops it (api/stores/[id]/templates/route.ts:167) —
// Gary's addition 2, 2026-11-11: Missed keeps today's Home behaviour.
//
// What "in progress" means is the caller's: it needs the checklist rows and
// this device's unsaved ticks, which this pure module does not see.

function switcherRank<T extends TodayEntry>(e: T, inProgress: (e: T) => boolean): number {
  if (e.lifecycleState === "completed") return 3
  if (inProgress(e)) return 0
  if (e.lifecycleState === "upcoming") return 2
  return 1
}

/** Today's checklists in tab order. The first one is the auto-pick. */
export function orderTodayChecklists<T extends TodayEntry>(entries: T[], inProgress: (e: T) => boolean): T[] {
  return entries
    .filter((e) => e.lifecycleState !== "missed")
    .map((e) => ({ e, rank: switcherRank(e, inProgress) }))
    .sort((a, b) => a.rank - b.rank || byDue(a.e, b.e))
    .map(({ e }) => e)
}

// WHICH CHECKLIST THE CARD SHOWS. Local UI state only (R3): no URL, no write,
// no fetch, and the panel that holds it is keyed by store and day
// (tablet-home.tsx), so a reload, a store switch or a new day starts it over.
//
//   manual — the tab last tapped. Wins over the auto-pick while it is still
//            in today's list.
//   open   — the checklist whose tick list ("list") or Done screen ("done") is
//            open in the card. OPENING COUNTS AS A MANUAL PICK, and the
//            auto-pick NEVER swaps the card while something is open (Gary's
//            addition 1, 2026-11-11): a re-read that reorders the list must
//            not pull a tick list out from under the person ticking it.
//
// With nothing tapped and nothing open the card follows the auto-pick as
// re-reads land (RN-3).

export type SwitcherView = "list" | "done"

export interface SwitcherState {
  manual: string | null
  open: { id: string; view: SwitcherView } | null
}

export type SwitcherAction =
  | { type: "tap"; id: string }
  | { type: "open"; id: string; view: SwitcherView }
  | { type: "close" }

export const initialSwitcher: SwitcherState = { manual: null, open: null }

export function switcherReducer(state: SwitcherState, action: SwitcherAction): SwitcherState {
  switch (action.type) {
    // A tab tap always lands on that tab's summary card — including a tap on
    // the tab whose tick list is open, which is how a crew gets back to it.
    case "tap":
      return { manual: action.id, open: null }
    case "open":
      return { manual: action.id, open: { id: action.id, view: action.view } }
    case "close":
      return state.open ? { ...state, open: null } : state
  }
}

/** The id the card shows, and what is open in it (null = the summary card).
 *  `orderedIds` is orderTodayChecklists' output; an id that has left the list
 *  (a template archived mid-day) falls back to the auto-pick. */
export function shownChecklist(
  state: SwitcherState,
  orderedIds: string[]
): { id: string | null; view: SwitcherView | null } {
  if (state.open && orderedIds.includes(state.open.id)) return { id: state.open.id, view: state.open.view }
  if (state.manual && orderedIds.includes(state.manual)) return { id: state.manual, view: null }
  return { id: orderedIds[0] ?? null, view: null }
}

// ─── TAB-14 — the tablet Checklists page ─────────────────────────────────────
//
// R4 (Gary, 2026-11-11): the page uses TAB-13's order unchanged — call
// orderTodayChecklists() first — and then splits it. The first three ranks
// (in progress, not started and due now, not started and upcoming) are big
// tiles, in that order; COMPLETED collapses into a "Done today" row at the
// bottom, in the same order. Missed never arrives here (orderTodayChecklists
// drops it, and so does the source route).

export function splitForChecklistsPage<T extends TodayEntry>(ordered: T[]): { tiles: T[]; doneToday: T[] } {
  return {
    tiles: ordered.filter((e) => e.lifecycleState !== "completed"),
    doneToday: ordered.filter((e) => e.lifecycleState === "completed"),
  }
}

// The hero's / tile's time chip, in the STORE's zone. dueChipLabel is tablet
// Home's dueLabel() MOVED HERE UNCHANGED by TAB-14 (RN-2) so the Checklists
// page's chip reads the same. opensChipLabel is TAB-14 RN-1 (Gary,
// 2026-11-11): an upcoming checklist's window START, formatted "the same way
// dueLabel does" — formatWindowTime in the store's zone.

export function dueChipLabel(e: { expectedEndAt: string | null; lifecycleState: ChecklistState; timeZone: string }): string | null {
  if (!e.expectedEndAt) return null
  const at = formatWindowTime(new Date(e.expectedEndAt), e.timeZone)
  return e.lifecycleState === "overdue" ? `Overdue · was due ${at}` : `Due ${at}`
}

export function opensChipLabel(e: { expectedStartAt?: string | null; timeZone: string }): string | null {
  if (!e.expectedStartAt) return null
  return `Opens ${formatWindowTime(new Date(e.expectedStartAt), e.timeZone)}`
}
