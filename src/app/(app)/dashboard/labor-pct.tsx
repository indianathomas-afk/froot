"use client"

import {
  formatLaborPct,
  judgeLaborPct,
  laborFootnotes,
  laborVerdictBar,
  laborVerdictClass,
  type LaborBlock,
} from "@/lib/labor-judgment"

// AL-2 — the labor % readout, ONE COMPONENT FOR ALL THREE SURFACES. The Sales
// Performance card, the Monthly Goal card and the All Locations view render the
// same number under the same rules; three hand-written copies is how two of them
// end up disagreeing about what "over budget" looks like.
//
// EVERY HONESTY RULE IS ENFORCED HERE RATHER THAN AT THE CALL SITES:
//   • laborPct null renders an em-dash and "no sales yet" — NEVER 0%.
//   • stale / error / never are never painted green or red (judgeLaborPct returns
//     "unjudged"), so an old number cannot read as a current verdict.
//   • otApplied:false, costComplete:false, partial coverage and open timecards
//     all get a visible line — see laborFootnotes.

export function laborNoValueLabel(block: LaborBlock): string {
  if (block.health === "never") return "not synced"
  if (block.laborPct === null) return "no sales yet"
  return ""
}

/// The Sales Performance card's fourth metric: value, budget line, slim meter.
/// R5 (Gary, 2026-08-19) — the sales graph is NOT recoloured; this meter is the
/// "green bar when within budget" of vision item 1, sitting in the metric row
/// where the number it describes already lives.
export function LaborPctMetric({ block, label = "Labor %" }: { block: LaborBlock; label?: string }) {
  const verdict = judgeLaborPct(block.laborPct, block.target, block.health)
  const note = laborNoValueLabel(block)
  // "Budget used" — capped at 100 so an over-budget store shows a full red bar
  // rather than one that overflows its track and stops being comparable.
  const fill = block.laborPct === null ? 0 : Math.min(100, (block.laborPct / block.target) * 100)

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className={`text-[15px] font-extrabold ${laborVerdictClass(verdict)}`}>
          {formatLaborPct(block.laborPct)}
          {block.laborPct !== null && <span className="font-normal">*</span>}
        </p>
        {note && <span className="text-[11px] text-[var(--color-muted-foreground)]">{note}</span>}
      </div>
      <div className="h-[6px] rounded-full bg-[var(--color-muted)] overflow-hidden mt-1 max-w-[120px]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${fill.toFixed(1)}%`, backgroundColor: laborVerdictBar(verdict) }}
        />
      </div>
      <p className="text-[10.5px] text-[var(--color-muted-foreground)] mt-0.5">
        {`target ${block.target.toFixed(1)}%`}
      </p>
    </div>
  )
}

/// The compact form for the Monthly Goal card and the All Locations summary card:
/// one value with its verdict colour and its target, no meter.
export function LaborPctLine({ block, label }: { block: LaborBlock; label: string }) {
  const verdict = judgeLaborPct(block.laborPct, block.target, block.health)
  const note = laborNoValueLabel(block)
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12.5px] text-[var(--color-muted-foreground)]">{label}</span>
      <span className={`text-[13px] font-bold ${laborVerdictClass(verdict)}`}>
        {formatLaborPct(block.laborPct)}
        {block.laborPct !== null && <span className="font-normal">*</span>}
        {note && <span className="ml-1 text-[11px] font-normal text-[var(--color-muted-foreground)]">{note}</span>}
      </span>
    </div>
  )
}

/// The store-ranking table cell (feature 7). Green within budget, red over — the
/// same three-zone scale, so the column and the cards never disagree.
export function LaborPctCell({ block }: { block: LaborBlock | undefined }) {
  if (!block) return <span className="text-[var(--color-muted-foreground)]">—</span>
  const verdict = judgeLaborPct(block.laborPct, block.target, block.health)
  return (
    <span
      className={laborVerdictClass(verdict)}
      title={
        block.health !== "fresh"
          ? `Not judged against budget — labor data is ${block.health}`
          : `Target ${block.target.toFixed(1)}%${
              block.daysCovered < block.daysInWindow
                ? ` · ${block.daysCovered} of ${block.daysInWindow} days synced`
                : ""
            }`
      }
    >
      {formatLaborPct(block.laborPct)}
      {block.laborPct === null && block.health === "never" && (
        <span className="ml-1 text-[11px] text-[var(--color-muted-foreground)]">not synced</span>
      )}
    </span>
  )
}

/// The footnote stack. Warnings reuse the affordance the seam named — the
/// "No store assigned" line on staff/[id] — because the wage gap has the same
/// shape: a number that is quietly incomplete until someone fixes data elsewhere.
export function LaborNotes({ block, timeZone }: { block: LaborBlock; timeZone?: string }) {
  const notes = laborFootnotes(block, timeZone)
  if (notes.length === 0) return null
  return (
    <div className="mt-1.5 space-y-0.5">
      {notes.map((n, i) => (
        <p
          key={i}
          className={`text-[11px] ${
            n.tone === "warn" ? "text-[var(--color-warning,#efa201)]" : "text-[var(--color-muted-foreground)]"
          }`}
        >
          {n.text}
        </p>
      ))}
    </div>
  )
}
