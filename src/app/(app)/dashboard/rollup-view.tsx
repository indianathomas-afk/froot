"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchCard } from "./card-fetch"
import { DatePicker, PRESETS, rangeLabel, resolvePreset, type Preset } from "./date-range-picker"
import { LaborNotes, LaborPctCell, LaborPctLine } from "./labor-pct"
import { formatLaborPct, judgeLaborPct, laborVerdictClass, type EstateLaborBlock, type LaborBlock } from "@/lib/labor-judgment"
import { formatTipsPerHour, tipFootnotes, type TipBlock } from "@/lib/labor-costs"

// ─── All-locations rollup (Phase F-4) ─────────────────────────────────────────
// Company-wide totals + a store ranking table, backed by /api/dashboard/rollup.
// The server does all the math (src/lib/pacing.ts) — this component only
// formats and sorts.

type RollupRow = {
  storeId: string
  name: string
  salesAvailable: boolean
  goalSource: "plan" | "manual" | null
  todayNet: number
  mtdActual: number
  // AL-2 feature 6 — net sales over the SELECTED RANGE, beside the labor % so the
  // percentage is checkable against the sales it divides by.
  rangeNet: number
  mtdGoal: number | null
  monthGoal: number | null
  pace: number | null
  projected: number | null
  pctToGoal: number | null
  // AL-2 feature 7 — absent when the overlay is off or the viewer lacks
  // labor.actuals.view, so the column disappears rather than rendering dashes.
  labor?: LaborBlock
  // AL-3 feature 5 — average hourly tip payout. GATED SEPARATELY FROM `labor`
  // and one tier higher: the percentage is OPERATIONAL (Q-V), tips are MANAGE
  // (Gary's Q8, 2026-08-19). A STORE account receiving `labor` still receives no
  // `tips` key at all.
  tips?: TipBlock
}

type Rollup = {
  month: string
  range: { start: string; end: string }
  totals: {
    todayNet: number
    mtdActual: number
    mtdGoal: number | null
    monthGoal: number | null
    projected: number | null
    pctToGoal: number | null
  }
  stores: RollupRow[]
  // AL-2 feature 4 — the company-wide labor card. Month-anchored: the range
  // picker drives the ranking table only (Gary's R6, 2026-08-19).
  laborTotals?: {
    today: EstateLaborBlock
    mtd: EstateLaborBlock
    projectedPct: number | null
    projectionDaysCovered: number
  }
}

// ─── Range selection (session-scoped, same external-store pattern as the Sales
// Performance card's — a separate key, because the two views are navigated
// independently and a range chosen for one store is rarely the one wanted for
// the estate) ────────────────────────────────────────────────────────────────

const RANGE_KEY = "froot.dashboard.rollupRange"
const RANGE_EVENT = "froot-dashboard-rollup-range"

type SavedRange = { preset: Preset; start: string; end: string }

function subscribeRange(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(RANGE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(RANGE_EVENT, callback)
  }
}

function saveRange(r: SavedRange) {
  sessionStorage.setItem(RANGE_KEY, JSON.stringify(r))
  window.dispatchEvent(new Event(RANGE_EVENT))
}

function parseSavedRange(raw: string | null): SavedRange | null {
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as SavedRange
    if (!PRESETS.includes(r.preset)) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start) || !/^\d{4}-\d{2}-\d{2}$/.test(r.end)) return null
    // Named presets stay semantic across midnight — re-resolve to today.
    if (r.preset !== "custom") return { ...r, ...resolvePreset(r.preset) }
    return r
  } catch {
    return null
  }
}

const usd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`)

type SortKey = "name" | "todayNet" | "mtdActual" | "rangeNet" | "laborPct" | "tipsPerHour" | "pace" | "projected" | "pctToGoal"

/// AL-3 feature 5 — one store's average hourly tip payout.
///
/// The caveats ride in the TITLE rather than as a footnote stack, because this
/// is one cell in a dense ranking table and laborFootnotes' stacked-sentence
/// treatment belongs to a card. The sentences themselves come from
/// tipFootnotes, so the wording cannot drift from wherever else it is shown.
///
/// NULL IS AN EM DASH, NEVER $0.00 — no tip-eligible hours in the range is "not
/// yet a rate", which is a different sentence from "this store tips nothing".
function TipsCell({ block }: { block?: TipBlock }) {
  if (!block) return <span className="text-[var(--color-muted-foreground)]">—</span>
  const notes = tipFootnotes(block)
  return (
    <span
      className={
        block.avgHourlyTips === null
          ? "text-[var(--color-muted-foreground)] cursor-help"
          : "text-[var(--color-foreground)] cursor-help"
      }
      title={notes.map((n) => n.text).join("\n")}
    >
      {formatTipsPerHour(block.avgHourlyTips)}
      {/* The asterisk is the visible hook for the title text. Without it a
          possibly-double-counted upper bound looks exact. */}
      {block.avgHourlyTips !== null && block.declaredCashTips > 0 && (
        <span className="text-[var(--color-muted-foreground)]">*</span>
      )}
    </span>
  )
}

// canViewForecasting: PERM-3 — the Store Ranking header's "Forecasting →" link
// rendered for every role before this, including STORE/STAFF who cannot open
// the destination. Required (not defaulted) because there is exactly one caller.
export function RollupView({ canViewForecasting }: { canViewForecasting: boolean }) {
  const [data, setData] = useState<Rollup | null>(null)
  const [failed, setFailed] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("mtdActual")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const savedRaw = useSyncExternalStore(
    subscribeRange,
    () => sessionStorage.getItem(RANGE_KEY),
    () => null
  )
  // Defaults to the current month, which is what this view showed before AL-2 —
  // so a first visit with no saved selection renders the pre-AL-2 table.
  const { preset, range } = useMemo(() => {
    const r = parseSavedRange(savedRaw)
    return r
      ? { preset: r.preset, range: { start: r.start, end: r.end } }
      : { preset: "this_month" as Preset, range: resolvePreset("this_month") }
  }, [savedRaw])

  const load = useCallback(() => {
    fetchCard<Rollup>("rollup", `/api/dashboard/rollup?start=${range.start}&end=${range.end}`).then((d) =>
      d ? setData(d) : setFailed(true)
    )
  }, [range.start, range.end])

  useEffect(() => {
    load()
  }, [load])

  // Manual retry only: back to the skeleton, then one refetch.
  const retry = () => {
    setFailed(false)
    setData(null)
    load()
  }

  // Both optional blocks live one level down. A store with no labor or no tip
  // data sorts as null and sinks, by the same rule as every other column — an
  // absent figure must never sort as a zero.
  const nested = (r: RollupRow, key: SortKey): number | null => {
    if (key === "laborPct") return r.labor?.laborPct ?? null
    if (key === "tipsPerHour") return r.tips?.avgHourlyTips ?? null
    return r[key] as number | null
  }

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.stores].sort((a, b) => {
      if (sortKey === "name") return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      // laborPct lives one level down, inside the optional block. A store with no
      // labor data sorts as null and sinks, by the same rule as every other
      // column below — an absent percentage must never sort as a zero.
      const av = nested(a, sortKey)
      const bv = nested(b, sortKey)
      // Stores with no value for the column always sink to the bottom.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sortDir === "asc" ? av - bv : bv - av
    })
  }, [data, sortKey, sortDir])

  if (failed) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Couldn&apos;t load the all-locations rollup — the request failed or timed out.
          </p>
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <Skeleton className="h-32 flex-1 min-w-[240px]" />
          <Skeleton className="h-32 flex-1 min-w-[240px]" />
          <Skeleton className="h-32 flex-1 min-w-[240px]" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { totals } = data
  const monthName = new Date(`${data.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
  const rangeLbl = rangeLabel(data.range.start, data.range.end)
  // The column appears only when the server actually sent labor for someone —
  // gates off means no `labor` key on any row, and therefore no column at all
  // rather than a column of dashes.
  const hasLabor = data.stores.some((s) => s.labor)
  // Same rule, its own gate: the server sends no `tips` key to a viewer below
  // MANAGE, so the column disappears rather than rendering a column of dashes.
  const hasTips = data.stores.some((s) => s.tips)
  const paceTotal = totals.mtdGoal !== null && totals.mtdGoal > 0 ? (totals.mtdActual / totals.mtdGoal) * 100 : null
  const onTrack = totals.pctToGoal !== null && totals.pctToGoal >= 100

  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th
      className={`py-1 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        className="inline-flex items-center gap-0.5 hover:text-[var(--color-primary)]"
        onClick={() => {
          if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
          else {
            setSortKey(key)
            setSortDir(key === "name" ? "asc" : "desc")
          }
        }}
      >
        {label}
        {sortKey === key &&
          (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )

  return (
    <div className="space-y-4">
      {/* Company-wide totals */}
      <div className="flex flex-wrap gap-4">
        <Card className="flex-1 min-w-[240px]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">Today · All Locations</p>
            <p className="text-[28px] leading-tight font-extrabold text-[var(--color-foreground)]">{usd(totals.todayNet)}</p>
            <p className="text-[12.5px] text-[var(--color-muted-foreground)]">net sales across {data.stores.length} store{data.stores.length === 1 ? "" : "s"}</p>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[240px]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">{monthName} to Date</p>
            <p className="text-[28px] leading-tight font-extrabold text-[var(--color-foreground)]">{usd(totals.mtdActual)}</p>
            <p className="text-[12.5px] text-[var(--color-muted-foreground)] mb-2">
              {totals.mtdGoal !== null ? `of ${usd(totals.mtdGoal)} MTD goal` : "no goals set"}
            </p>
            {totals.mtdGoal !== null && totals.mtdGoal > 0 && (
              <>
                <div className="h-[11px] rounded-full bg-[var(--color-muted)] overflow-hidden mb-1.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#F4A462] to-[var(--color-primary)]"
                    style={{ width: `${Math.min(100, (totals.mtdActual / totals.mtdGoal) * 100).toFixed(1)}%` }}
                  />
                </div>
                <p className="text-[13px] font-bold text-[var(--color-primary)]">{pct(paceTotal)} of MTD goal</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[240px]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">Projected Month End</p>
            <p className="text-[28px] leading-tight font-extrabold text-[var(--color-foreground)]">{usd(totals.projected)}</p>
            {totals.monthGoal !== null ? (
              <p
                className={`text-[12.5px] font-bold ${
                  onTrack ? "text-[var(--color-success-text,#1d7c2e)]" : "text-[var(--color-warning-text,#a36a00)]"
                }`}
              >
                {pct(totals.pctToGoal)} of the {usd(totals.monthGoal)} goal
              </p>
            ) : (
              <p className="text-[12.5px] text-[var(--color-muted-foreground)]">run-rate — no goals set</p>
            )}
          </CardContent>
        </Card>

        {/* AL-2 feature 4 — company-wide labor %, month-anchored beside the three
            sales cards it belongs with. Absent entirely when the overlay is off
            or the viewer lacks labor.actuals.view. */}
        {data.laborTotals && (
          <Card className="flex-1 min-w-[240px]">
            <CardContent className="pt-5 pb-4">
              <p className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">Labor %</p>
              <p
                className={`text-[28px] leading-tight font-extrabold ${laborVerdictClass(
                  judgeLaborPct(data.laborTotals.mtd.laborPct, data.laborTotals.mtd.target, data.laborTotals.mtd.health)
                )}`}
              >
                {formatLaborPct(data.laborTotals.mtd.laborPct)}
                {data.laborTotals.mtd.laborPct !== null && <span className="text-base font-normal">*</span>}
              </p>
              <p className="text-[12.5px] text-[var(--color-muted-foreground)] mb-2">
                {monthName} to date · target {data.laborTotals.mtd.target.toFixed(1)}%
              </p>
              <div className="space-y-1">
                <LaborPctLine block={data.laborTotals.today} label="Today · all locations" />
                {/* THE PROJECTION IS LABELLED AS ONE (Gary's R4). Its denominator
                    is the goal-weighted Projected Month End sales figure printed
                    on the card to the left — one month-end sales number on this
                    page, not two — and its numerator is a run-rate over the days
                    that actually carry timecards. Mixed bases, said out loud. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] text-[var(--color-muted-foreground)]">Projected month end</span>
                  <span
                    className={`text-[13px] font-bold ${laborVerdictClass(
                      // Judgment withheld below a week of synced days: a run-rate
                      // built on one or two days is noise, and painting noise green
                      // is the false reassurance this phase exists to avoid.
                      data.laborTotals.projectionDaysCovered >= 7
                        ? judgeLaborPct(data.laborTotals.projectedPct, data.laborTotals.mtd.target, data.laborTotals.mtd.health)
                        : "unjudged"
                    )}`}
                  >
                    {formatLaborPct(data.laborTotals.projectedPct)}
                    {data.laborTotals.projectionDaysCovered < 7 && data.laborTotals.projectedPct !== null && (
                      <span className="ml-1 text-[11px] font-normal text-[var(--color-muted-foreground)]">
                        too early to judge
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <LaborNotes block={data.laborTotals.mtd} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Store ranking */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-bold text-[var(--color-foreground)]">Store Ranking</p>
              {/* AL-2 feature 6 — the same control the Sales Performance card
                  uses, imported rather than reimplemented. It drives THIS TABLE;
                  the three cards above stay month-anchored (R6). */}
              <DatePicker
                preset={preset}
                range={range}
                onApply={(p, r) => saveRange({ preset: p, start: r.start, end: r.end })}
              />
            </div>
            {canViewForecasting && (
              <Link href="/forecasting" className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]">
                Forecasting →
              </Link>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                  {header("name", "Store", "left")}
                  {header("todayNet", "Today")}
                  {header("mtdActual", "MTD")}
                  {/* The two range-driven columns sit together, labelled with the
                      selection, so it is never ambiguous which columns the picker
                      moves and which are month-anchored by definition. */}
                  {header("rangeNet", `Net · ${rangeLbl}`)}
                  {hasLabor && header("laborPct", `Labor % · ${rangeLbl}`)}
                  {/* Follows the picker, and the header says so (Gary's Q6) —
                      two range-driven columns side by side must not silently
                      mean different windows. */}
                  {hasTips && header("tipsPerHour", `Tips/hr · ${rangeLbl}`)}
                  {header("pace", "% to MTD goal")}
                  {header("projected", "Projected")}
                  {header("pctToGoal", "vs goal")}
                  <th className="py-1 font-medium text-right">Pace</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.storeId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-2 font-medium text-[var(--color-foreground)]">
                      {s.name}
                      {!s.salesAvailable && (
                        <span className="ml-1.5 text-xs font-normal text-[var(--color-muted-foreground)]" title="Not connected to Square — sales unavailable">
                          (no Square)
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">{s.salesAvailable ? usd(s.todayNet) : "—"}</td>
                    <td className="py-2 text-right">{s.salesAvailable ? usd(s.mtdActual) : "—"}</td>
                    <td className="py-2 text-right">{s.salesAvailable ? usd(s.rangeNet) : "—"}</td>
                    {hasLabor && (
                      <td className="py-2 text-right">
                        <LaborPctCell block={s.labor} />
                      </td>
                    )}
                    {hasTips && (
                      <td className="py-2 text-right">
                        <TipsCell block={s.tips} />
                      </td>
                    )}
                    <td className="py-2 text-right" title={s.goalSource === "manual" ? "Manual goal, prorated by days elapsed" : undefined}>
                      {pct(s.pace)}
                    </td>
                    <td className="py-2 text-right">{usd(s.projected)}</td>
                    <td className="py-2 text-right">{pct(s.pctToGoal)}</td>
                    <td className="py-2 text-right">
                      {s.pctToGoal === null ? (
                        <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                          No goal
                        </span>
                      ) : s.pctToGoal >= 100 ? (
                        <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-[#25ba3b]/10 text-[var(--color-success-text,#1d7c2e)]">
                          On pace
                        </span>
                      ) : (
                        <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-[#efa201]/10 text-[var(--color-warning-text,#a36a00)]">
                          Behind
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={8 + (hasLabor ? 1 : 0) + (hasTips ? 1 : 0)} className="py-6 text-center text-[var(--color-muted-foreground)]">
                      No stores assigned to you yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
