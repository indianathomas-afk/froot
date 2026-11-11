// TAB-5 — the tablet home's ONE refresh controller, its rules as pure
// functions so scripts/verify-tab5-refresh.ts can pin them without a database
// or a browser. The React half is src/app/(app)/dashboard/tablet-refresh.tsx.
//
// Gary's rulings, 2026-11-10 ("OK. Write TAB-5"):
//   1  The Tasks panel, the overdue chip and the compliance chip refresh on the
//      Messages timer: every TABLET_REFRESH_MS while visible, at once on
//      becoming visible again, never while hidden.
//   2  When the STORE'S LOCAL DATE changes, the next refresh reloads the tablet
//      home (header date, today's checklist, chips, strip, Messages).
//   3  Never interrupt someone mid-task: any sheet open, or a tick / submit /
//      send in flight, skips the whole cycle; it runs on the next one.
//   4  Ticks made on another device appear at the next refresh.
//
// THE TIMER IS TAB-2's, NOT A NEW ONE. TABLET_REFRESH_MS and canRefresh() stay
// in src/lib/tablet-messages.ts (verify-tab2-messages.ts pins them); this
// module re-exports the constant so the controller has one import, and
// shouldRunCycle() is canRefresh() widened from "a send" to "anything busy",
// plus "not already refreshing".
//
// OFFLINE GUARD (Gary, 2026-11-10, before PRE-PUSH-CHECK): "the controller
// skips any cycle that would call router.refresh() while navigator.onLine is
// false". Every cycle can end in router.refresh() (the Tasks panel's items
// are a server render), and a refresh whose request fails makes Next do a
// full browser navigation — on an unattended counter iPad with the wifi down,
// Safari's error page stays up until someone touches it. So a cycle does not
// start while the browser reports itself offline; it runs again once online.

import { TABLET_REFRESH_MS, canRefresh } from "@/lib/tablet-messages"

export { TABLET_REFRESH_MS }

/** Ruling 1 + 3: run this cycle only while the page is visible, nothing is
 *  busy (a sheet open or a write in flight, anywhere on the tablet home), no
 *  refresh is still running (never two at once), and — the offline guard —
 *  the browser does not report itself offline (`online` is
 *  navigator.onLine). */
export function shouldRunCycle(s: { visibilityState: string; busy: boolean; refreshing: boolean; online: boolean }): boolean {
  return canRefresh(s.visibilityState, s.busy) && !s.refreshing && s.online
}

/** TAB-8 — a cycle that would have run but for the offline guard. The guard
 *  itself is unchanged; the tablet counts such a cycle as a refresh that did
 *  not land, so its "Not updated since …" line can show while offline. */
export function skippedOnlyForOffline(s: { visibilityState: string; busy: boolean; refreshing: boolean; online: boolean }): boolean {
  return !s.online && shouldRunCycle({ ...s, online: true })
}

/** The offline guard for a single router.refresh() (also reached after this
 *  device's own writes, outside a cycle): refresh only while not offline. */
export function mayRefreshServer(online: boolean): boolean {
  return online
}

/** True when any registered busy flag is on, or any write is in flight. */
export function isBusy(flags: Iterable<boolean>, writesInFlight: number): boolean {
  if (writesInFlight > 0) return true
  for (const on of flags) if (on) return true
  return false
}

/** The store-local calendar date of an instant, "YYYY-MM-DD", in the STORE'S
 *  zone (Store.timezone) — never the browser's zone and never UTC.
 *
 *  THE SAME RULE AS localDateStr() in src/lib/reports.ts, which is what
 *  businessDayWindow() — and therefore the today's-checklist list
 *  (GET /api/stores/[id]/templates) and loadTabletData() — calls "today".
 *  Restated, not imported, because reports.ts imports Prisma and this runs in
 *  the browser; verify-tab5-refresh.ts asserts the two agree on every case. */
export function storeLocalDay(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Ruling 2: has the store-local date moved on since `sinceDay` (the day the
 *  tablet home is showing)? Forward only: a device clock running behind the
 *  server never reads as a rollover. YYYY-MM-DD strings order as dates. */
export function dayRolledOver(sinceDay: string, instant: Date, timeZone: string): boolean {
  return storeLocalDay(instant, timeZone) > sinceDay
}

/** Ruling 2 + 3: which day the tablet home should now SHOW. The server's day
 *  (what the last server render called today) is the source of truth, since it
 *  is what the today's-checklist rule used; the move happens only while nothing
 *  is busy, so a rollover never closes a sheet. */
export function nextShownDay(shownDay: string, serverDay: string, busy: boolean): string {
  return !busy && serverDay !== shownDay ? serverDay : shownDay
}

/** A tick this device made, shown at once over the server's rows. `settledAt`
 *  is when its write came back OK (ms epoch); absent while it is in flight. */
export type TickOverride = { done: boolean; value: number | null; settledAt?: number }

/** Ruling 4: drop every local tick the server has since caught up with, so a
 *  change made on another device shows through. An override is redundant once
 *  a server read that STARTED AFTER its write settled has landed (`syncedFrom`
 *  = that read's start time): that read already includes the write. A tick
 *  still in flight, or settled after the read began, is kept, so a refresh
 *  that raced a tap never makes the tick flicker off. Returns the same object
 *  when nothing is dropped. */
export function pruneOverrides(
  overrides: Record<string, TickOverride>,
  syncedFrom: number
): Record<string, TickOverride> {
  let changed = false
  const next: Record<string, TickOverride> = {}
  for (const [k, o] of Object.entries(overrides)) {
    // Strictly before: a write settling in the same millisecond the read began
    // may not be in it, so it is kept for one more cycle.
    if (o.settledAt !== undefined && o.settledAt < syncedFrom) changed = true
    else next[k] = o
  }
  return changed ? next : overrides
}
