// OVL-S4 — the overlay's CLIENT-SAFE DISPLAY HELPERS: the legend's series model
// (the one place that decides which curves are drawn) and the stale stamp's
// wording, which two surfaces now render.
//
// PURE, AND WITH NO IMPORTS AT ALL. That is not tidiness: labor-coverage-card
// is a "use client" component, and every other schedule-side module imports
// prisma. A helper living in labor-schedule.ts would drag the database client
// into the browser bundle. Keeping this file dependency-free is what lets ONE
// definition of "which series are visible" serve both the card and
// scripts/verify-labor-schedule.ts, instead of the card holding the rule and the
// fixture holding a copy of it.
//
// THE HIDDEN SET IS DISPLAY STATE AND NOTHING ELSE (Gary, 2026-08-20). No data
// is refetched, no computation changes, and the legend still lists every series
// the day has — a hidden series is MUTED, never removed. A chip that vanished
// when clicked would leave no way to bring the curve back.

/// The suggested (recommended-coverage) curve. Matches the Recharts dataKey.
export const SUGGESTED_KEY = "headcount"

/// The active overlay curve — scheduled or clocked-in, whichever mode is on.
/// One key for both because only one of them is ever drawn at a time.
export const OVERLAY_KEY = "overlayTotal"

/// The per-position curve for one Square job id, as Recharts sees it. The
/// `job:` prefix is what keeps a job id from colliding with the two keys above.
export function jobSeriesKey(jobId: string): string {
  return `job:${jobId}`
}

/// Every chip the legend renders, in render order. THE COUNT IS INDEPENDENT OF
/// `hidden` on purpose — this is the list of chips, and hiding a series must
/// never change it.
export function legendSeriesKeys({
  hasOverlay,
  jobKeys,
}: {
  hasOverlay: boolean
  jobKeys: string[]
}): string[] {
  return [
    SUGGESTED_KEY,
    ...(hasOverlay ? [OVERLAY_KEY] : []),
    ...(hasOverlay ? jobKeys.map(jobSeriesKey) : []),
  ]
}

/// The subset of the above that is actually drawn. A key in `hidden` is omitted
/// from the chart while its chip stays on the legend.
export function visibleSeriesKeys({
  hasOverlay,
  jobKeys,
  hidden,
}: {
  hasOverlay: boolean
  jobKeys: string[]
  hidden: ReadonlySet<string>
}): string[] {
  return legendSeriesKeys({ hasOverlay, jobKeys }).filter((k) => !hidden.has(k))
}

/// Toggling one chip. Returned as a NEW set rather than mutated, because the
/// caller is React state and a mutated Set does not re-render.
export function toggleSeries(hidden: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(hidden)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/// Coarse age for seam (c)'s stale stamp. Deliberately coarse — the reader needs
/// "this is old", not a duration to the minute.
///
/// SHARED SINCE OVL-S4, because the /labor comparison shows the same staleness
/// as the Labor Coverage card, for the same sync, at the same 26h threshold. Two
/// copies of this string would eventually put two differently-worded warnings on
/// two surfaces for one outage — the same argument D5 made for the threshold
/// itself.
export function agoLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "some time ago"
  const hours = (now - new Date(iso).getTime()) / 3600000
  if (hours < 1) return "under an hour ago"
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}
