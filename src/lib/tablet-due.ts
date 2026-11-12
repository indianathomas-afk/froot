// TAB-1c — the tablet overdue chip's rule, as a pure function so
// scripts/verify-tab1c-due-chip.ts can pin it without a database or a browser.
//
// MOVED, NOT CHANGED. This is the filter and count DueChip in
// src/app/(app)/dashboard/tablet-home.tsx ran inline since TAB-1 (adec345).
// TAB-1c found it correct: the staging "no chip" reports came from an empty due
// feed (a new reminder has no occurrence row until the calendar-materialize
// cron runs, and Vercel never fires crons on staging) and from reading the
// SELF-1 compliance banner as the calendar banner. Nothing here changes what
// the chip shows.
//
// THE RULES ARE THE DESKTOP BANNER'S (src/components/calendar-due-banner.tsx):
//   - which items: GET /api/calendar/due already scopes to the actor; the
//     tablet keeps the ones whose flat `storeId` is the selected store. A
//     fan-out ("all stores") reminder arrives as one occurrence per store, each
//     with its own storeId, so it needs no special case.
//   - overdue: `dueAt <= now` (CAL-1 ruling 8), NOT `daysOverdue > 0`
//     (CAL-2b / DEBT-101): an item past its store's close on its own due date
//     is overdue AND zero days old. Same rule as the banner's chipsFor().
//   - due today but not yet overdue: listed and counted in "due", amber, as the
//     banner lists it and colours it.

export type TabletDueItem = {
  id: string
  storeId: string
  dueAt: string
  daysOverdue: number
}

export function isOverdue(item: { dueAt: string }, nowIso: string): boolean {
  return item.dueAt <= nowIso
}

export type TabletDueChip<T extends TabletDueItem> = {
  /** This store's items, in feed order (the feed sorts by dueAt). */
  items: T[]
  overdue: number
  /** What the chip reads, or null when it does not render. */
  label: string | null
}

export function dueChipFor<T extends TabletDueItem>(feed: T[], storeId: string, nowIso: string): TabletDueChip<T> {
  const items = feed.filter((i) => i.storeId === storeId)
  const overdue = items.filter((i) => isOverdue(i, nowIso)).length
  const label = items.length === 0 ? null : overdue > 0 ? `${overdue} overdue` : `${items.length} due`
  return { items, overdue, label }
}

/** The second line of one row in the sheet, after the category label. */
export function dueRowSuffix(item: TabletDueItem, nowIso: string): string {
  if (!isOverdue(item, nowIso)) return " · due today"
  if (item.daysOverdue > 0) return ` · ${item.daysOverdue} ${item.daysOverdue === 1 ? "day" : "days"} overdue`
  return " · overdue"
}

/** TAB-14 — the due feed's URL. No store = every store the actor can see (the
 *  desktop banner, unchanged); a store = that store only, through the route's
 *  existing `?storeId=` (api/calendar/due/route.ts → resolveStoreScope, which
 *  answers [that store] when the actor may see it and [] when not). That is
 *  the same set dueChipFor() keeps for tablet Home's chip. Used by
 *  CalendarDueBanner; pinned by scripts/verify-tab14-checklists.ts. */
export function dueFeedUrl(storeId?: string | null): string {
  return storeId ? `/api/calendar/due?storeId=${encodeURIComponent(storeId)}` : "/api/calendar/due"
}
