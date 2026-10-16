import { Clock } from "lucide-react"
import { BADGE_PRESETS } from "@/lib/badge-presets"
import type { OnTimeResult, OnTimeStatus } from "@/lib/attendance"

// MS-2 — THE ON-TIME BADGE, both sizes. A SERVER component: the result arrives
// fully computed (src/lib/attendance.ts) and this file only maps it to words
// and colours.
//
// NO DESIGN BUNDLE (F0, Gary 2026-10-16: "Use the fallback — existing Froot
// components (BADGE_PRESETS, the status pill)"). Colours are BADGE_PRESETS'
// literal class strings — green, amber (the palette has no yellow on purpose,
// TPL-1a), red, and gray for every "can't say" state. The pill shape is the
// /staff/[id] documents status pill (staff-documents.tsx): rounded-full, border,
// the 100/700/200 trio.
//
// THE GATE IS THE CALLER'S. Both pages render this only with Milestones on and
// for an ADMIN or in-scope MANAGER (F6).

const CLASS: Record<OnTimeStatus, string> = {
  green: BADGE_PRESETS.green.badge,
  amber: BADGE_PRESETS.amber.badge,
  red: BADGE_PRESETS.red.badge,
  "not-enough": BADGE_PRESETS.gray.badge,
  "no-schedule": BADGE_PRESETS.gray.badge,
  "not-linked": BADGE_PRESETS.gray.badge,
}

const GREY_LABEL: Partial<Record<OnTimeStatus, string>> = {
  "not-enough": "Not enough shifts",
  "no-schedule": "No schedule data",
  "not-linked": "Not linked to Square",
}

function isColoured(s: OnTimeStatus): boolean {
  return s === "green" || s === "amber" || s === "red"
}

/// The one-line explanation — the full badge's sub-line and the compact
/// badge's tooltip, so the two always say the same thing.
export function onTimeExplanation(r: OnTimeResult, lookbackDays: number): string {
  const window = `last ${lookbackDays} days`
  if (r.status === "not-linked") return "No Square team member is linked to this person, so there are no shifts to compare."
  if (r.status === "no-schedule") {
    return r.reason === "square-labor-off"
      ? "Square labor isn't switched on for this organization, so there are no scheduled shifts to compare."
      : `No published Square shifts at this person's stores in the ${window}.`
  }
  if (r.status === "not-enough") {
    return `Only ${r.total} scheduled shift${r.total === 1 ? "" : "s"} in the ${window} — fewer than the minimum to show a percentage.`
  }
  return `On time in ${r.onTime} of ${r.total} shifts, ${window}.`
}

export function OnTimeBadge({
  result,
  lookbackDays,
  size,
}: {
  result: OnTimeResult
  lookbackDays: number
  size: "full" | "compact"
}) {
  const coloured = isColoured(result.status) && result.displayPercent !== null
  if (size === "compact") {
    // Beside the name on /staff (F7) — the "You" / "Terminated" badge slot,
    // so the table gains no column. Percent and colour only; the grey states
    // say a short word and the tooltip says why.
    return (
      <span
        title={onTimeExplanation(result, lookbackDays)}
        className={`ml-2 inline-flex items-center gap-1 align-middle text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap cursor-help ${CLASS[result.status]}`}
      >
        <Clock className="h-3 w-3" />
        {coloured ? `${result.displayPercent}% on time` : "On time —"}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full border ${CLASS[result.status]}`}>
      <Clock className="h-4 w-4" />
      {coloured ? `${result.displayPercent}% on time` : GREY_LABEL[result.status]}
    </span>
  )
}

/// The Milestones tab card: the full badge plus the "on time in N of M shifts,
/// last X days" line. Stacked, no fixed widths — readable at phone width.
export function OnTimeCard({ result, lookbackDays }: { result: OnTimeResult; lookbackDays: number }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">On-time</p>
      <OnTimeBadge result={result} lookbackDays={lookbackDays} size="full" />
      <p className="text-sm text-[var(--color-muted-foreground)] mt-2">{onTimeExplanation(result, lookbackDays)}</p>
    </div>
  )
}
