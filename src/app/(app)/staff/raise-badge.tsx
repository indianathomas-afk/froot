import { TrendingUp, Check, X, Minus, Ban, CircleDashed } from "lucide-react"
import { BADGE_PRESETS } from "@/lib/badge-presets"
import { formatCivilDate } from "@/lib/display-time"
import type { RaiseCriterionState, RaiseEligibility, RaiseStatus } from "@/lib/raise-eligibility"

// MS-3a — THE RAISE ELIGIBILITY BADGE, both sizes, and the Milestones tab card.
// A SERVER component: the result arrives fully computed
// (src/lib/raise-eligibility.ts) and this file only maps it to words and
// colours.
//
// NO DESIGN BUNDLE (Gary, 2026-10-16, extending his MS-2 ruling to MS-3a and
// MS-3b). COPIED FROM src/app/(app)/staff/on-time-badge.tsx: the compact pill
// beside the name (same classes, same tooltip-for-why), the full pill and the
// card shell. Colours are BADGE_PRESETS — "yellow" renders as AMBER because the
// palette has no yellow on purpose (TPL-1a), exactly as the On-Time badge does.
//
// THE GATE IS THE CALLER'S. Both pages render this only with Milestones on, the
// Square labor overlay on (F12), for an ADMIN or in-scope MANAGER (ruling 2),
// and never for a terminated member.

const CLASS: Record<RaiseStatus, string> = {
  green: BADGE_PRESETS.green.badge,
  yellow: BADGE_PRESETS.amber.badge,
  red: BADGE_PRESETS.red.badge,
}

const LABEL: Record<RaiseStatus, string> = {
  green: "Raise eligible",
  yellow: "Raise in progress",
  red: "Raise blocked",
}

/// The one-line why — the compact badge's tooltip.
export function raiseExplanation(r: RaiseEligibility): string {
  if (r.status === "green") return "Every raise rule is met."
  const open = r.criteria.filter((c) => c.state === "blocked" || c.state === "not-met" || c.state === "no-data")
  return open.map((c) => `${c.label}: ${c.detail}`).join(" ")
}

export function RaiseBadge({ result, size }: { result: RaiseEligibility; size: "full" | "compact" }) {
  if (size === "compact") {
    return (
      <span
        title={raiseExplanation(result)}
        className={`ml-2 inline-flex items-center gap-1 align-middle text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap cursor-help ${CLASS[result.status]}`}
      >
        <TrendingUp className="h-3 w-3" />
        {LABEL[result.status]}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full border ${CLASS[result.status]}`}>
      <TrendingUp className="h-4 w-4" />
      {LABEL[result.status]}
    </span>
  )
}

const STATE: Record<RaiseCriterionState, { icon: typeof Check; word: string; tone: string }> = {
  met: { icon: Check, word: "Met", tone: "text-green-700" },
  "not-met": { icon: X, word: "Not met", tone: "text-amber-700" },
  blocked: { icon: Ban, word: "Not met", tone: "text-red-700" },
  "no-data": { icon: CircleDashed, word: "Not enough data", tone: "text-amber-700" },
  na: { icon: Minus, word: "N/A", tone: "text-[var(--color-muted-foreground)]" },
}

/// The Milestones tab card: the full badge, the weeks judged, and each rule as
/// met / not met / not enough data / N/A. Stacked, no fixed widths — readable at
/// phone width.
export function RaiseCard({ result }: { result: RaiseEligibility }) {
  // The weeks are civil store-local dates, so they render with no zone shift.
  const from = formatCivilDate(new Date(`${result.weeks.from}T00:00:00.000Z`), "medium")
  const to = formatCivilDate(new Date(`${result.weeks.to}T00:00:00.000Z`), "medium")
  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Raise eligibility</p>
      <RaiseBadge result={result} size="full" />
      <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
        Weeks judged: {from} – {to}. Visible to admins and managers only.
      </p>
      {result.criteria.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)] mt-3">No raise rules are switched on.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {result.criteria.map((c) => {
            const s = STATE[c.state]
            const Icon = s.icon
            return (
              <li key={c.key} className="py-2.5 flex items-start gap-2">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${s.tone}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    {c.label} <span className={`font-normal ${s.tone}`}>· {s.word}</span>
                  </p>
                  <p className="text-sm text-[var(--color-muted-foreground)] break-words">{c.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
