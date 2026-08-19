"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { CircleAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer } from "recharts"
// AL-2: the picker and its calendar arithmetic now live in one place, shared with
// the All Locations view — see date-range-picker.tsx.
import {
  DatePicker,
  PickerPill,
  PRESETS,
  daysInclusive,
  fmtDay,
  fromDateStr,
  rangeLabel,
  resolvePreset,
  shiftDateStr,
  toDateStr,
  type Preset,
} from "./date-range-picker"
import { fetchCard, POLL_ATTEMPTS, POLL_INTERVAL_MS } from "./card-fetch"
import { LaborNotes, LaborPctMetric } from "./labor-pct"
import type { LaborBlock } from "@/lib/labor-judgment"

// Sales Performance card (Dashboard) — date navigation + comparison baseline.
// The selection may be a single day (hourly pace chart) or a range (daily
// chart); data comes from /api/dashboard/sales, which resolves the comparison
// window server-side. The last selection persists for the browser session.

// ─── Types (mirror /api/dashboard/sales) ─────────────────────────────────────

type SeriesPoint = { x: string; net: number }

type WindowData = {
  net: number
  gross: number
  orders: number
  avgSale: number | null
  unconfirmed: number
  hasData: boolean
  series: SeriesPoint[]
}

type SalesResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  salesAvailable: boolean
  // BUG-6 — see the twin fields on /api/dashboard/summary's payload.
  salesRefreshing: boolean
  salesSyncedAt: string | null
  selection: { start: string; end: string }
  comparison: { start: string; end: string; mode: CompareMode }
  granularity: "hourly" | "daily"
  selected: WindowData | null
  compareData: WindowData | null
  // AL-2 — ABSENT, not null, when the Advanced Labor overlay is off or the viewer
  // lacks labor.actuals.view. An org without the overlay gets a payload with no
  // `labor` key at all, so this card renders byte-identically to Phase 1.
  labor?: LaborBlock
}

const COMPARE_MODES = [
  "prior_period",
  "same_weekday_last_year",
  "four_weeks_prior",
  "fifty_two_weeks_prior",
  "prior_year",
] as const
type CompareMode = (typeof COMPARE_MODES)[number]

function priorCalendarYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y - 1, m - 1, d)
  if (dt.getMonth() !== m - 1) dt.setDate(0) // Feb 29 → Feb 28
  return toDateStr(dt)
}

// Comparison window (same math as the API route) for the dropdown labels.
function resolveComparison(mode: CompareMode, start: string, end: string): { start: string; end: string } {
  const n = daysInclusive(start, end)
  const compStart =
    mode === "prior_period"
      ? shiftDateStr(start, -n)
      : mode === "four_weeks_prior"
        ? shiftDateStr(start, -28)
        : mode === "prior_year"
          ? priorCalendarYear(start)
          : shiftDateStr(start, -364) // same_weekday_last_year & fifty_two_weeks_prior
  return { start: compStart, end: shiftDateStr(compStart, n - 1) }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const usd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

function hourLabel(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

function weekdayShort(dateStr: string): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", { weekday: "short" })
}

function compareModeLabel(mode: CompareMode, start: string, end: string): string {
  switch (mode) {
    case "prior_period":
      return "Prior period"
    case "same_weekday_last_year":
      return start === end ? `Prior ${weekdayShort(start)} last year` : "Same period last year"
    case "four_weeks_prior":
      return "4 weeks prior"
    case "fifty_two_weeks_prior":
      return "52 weeks prior"
    case "prior_year":
      return "Prior year"
  }
}

// ─── Session persistence (same external-store pattern as the store selector,
// but sessionStorage: the selection survives reloads and resets next session) ──

const SELECTION_KEY = "froot.dashboard.salesSelection"
const SELECTION_EVENT = "froot-dashboard-sales-selection"

type SavedSelection = { preset: Preset; start: string; end: string; compare: CompareMode }

function subscribeSelection(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(SELECTION_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(SELECTION_EVENT, callback)
  }
}

function useSavedSelectionRaw(): string | null {
  return useSyncExternalStore(
    subscribeSelection,
    () => sessionStorage.getItem(SELECTION_KEY),
    () => null
  )
}

function saveSelection(s: SavedSelection) {
  sessionStorage.setItem(SELECTION_KEY, JSON.stringify(s))
  window.dispatchEvent(new Event(SELECTION_EVENT))
}

function parseSavedSelection(raw: string | null): SavedSelection | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as SavedSelection
    if (!PRESETS.includes(s.preset) || !COMPARE_MODES.includes(s.compare)) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.start) || !/^\d{4}-\d{2}-\d{2}$/.test(s.end)) return null
    if (s.preset !== "custom") {
      // Named presets stay semantic across midnight — re-resolve to today.
      const r = resolvePreset(s.preset)
      return { ...s, start: r.start, end: r.end }
    }
    const today = toDateStr(new Date())
    const end = s.end > today ? today : s.end
    if (s.start > end) return null
    return { ...s, end }
  } catch {
    return null
  }
}

// Exposes the currently-viewed single day so the Labor Coverage card can align
// its hourly axis to the same day. A range selection resolves to its end day;
// no saved selection → null (the coverage card then defaults to today).
export function useSalesViewedDay(): string | null {
  const raw = useSavedSelectionRaw()
  const sel = parseSavedSelection(raw)
  if (!sel) return null
  return sel.start === sel.end ? sel.start : sel.end
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SalesPerformanceCard({ storeId }: { storeId: string }) {
  const savedRaw = useSavedSelectionRaw()
  const { preset, range, compare } = useMemo(() => {
    const s = parseSavedSelection(savedRaw)
    return s
      ? { preset: s.preset, range: { start: s.start, end: s.end }, compare: s.compare }
      : { preset: "today" as Preset, range: resolvePreset("today"), compare: "same_weekday_last_year" as CompareMode }
  }, [savedRaw])

  const [result, setResult] = useState<{ key: string; data: SalesResponse | null } | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const requestSeq = useRef(0)
  const requestKey = `${storeId}|${range.start}|${range.end}|${compare}`

  // BUG-6: same bounded poll as the summary card — the route defers its Square
  // refresh past the response, so a stale-cache load has to fetch again to see
  // it. `requestSeq` already guards against out-of-order responses; the poll
  // reuses it so a selection or store change abandons the sequence.
  //
  // Holds IN-FLIGHT sequence keys only, cleared in a finally — see the summary
  // card's pollGuard for why "every sequence ever started" latched on exactly
  // the case that needed a retry.
  const pollGuard = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!storeId) return
    const seq = ++requestSeq.current
    const key = `${storeId}|${range.start}|${range.end}|${compare}`
    const url = `/api/dashboard/sales?storeId=${storeId}&start=${range.start}&end=${range.end}&compare=${compare}`

    const poll = async (baseline: string | null) => {
      const guardKey = `${key}|${baseline ?? "none"}`
      if (pollGuard.current.has(guardKey)) return
      pollGuard.current.add(guardKey)
      try {
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          // Before the fetch AND after it resolves. requestSeq is bumped
          // synchronously at the top of this effect, so any store, range or
          // compare change retires an in-flight sequence immediately.
          if (seq !== requestSeq.current) return
          const json = await fetchCard<SalesResponse>("sales", url)
          if (seq !== requestSeq.current) return
          // Never write null over numbers already on screen — that is the card's
          // failed-load state (see the summary card's poll for the same note).
          if (!json) return
          setResult({ key, data: json })
          if (json.salesSyncedAt !== baseline) return
        }
      } finally {
        pollGuard.current.delete(guardKey)
      }
    }

    fetchCard<SalesResponse>("sales", url).then((json) => {
      if (seq !== requestSeq.current) return
      setResult({ key, data: json })
      if (json?.salesRefreshing) void poll(json.salesSyncedAt)
    })
  }, [storeId, range.start, range.end, compare, retryTick])

  const loading = !result || result.key !== requestKey
  // `data` is NOT keyed — it is whatever the last settled request returned,
  // which may belong to a previously selected store or date range. Every read
  // of it below sits inside the `loading ?` ternary, and `loading` is false
  // only when result.key === requestKey, so it can never paint under the wrong
  // store's label. RENDERING `data` OUTSIDE THAT TERNARY REINTRODUCES EXACTLY
  // THAT BUG — key it first if you need it in the header or the pickers.
  const data = result?.data ?? null

  const applySelection = (nextPreset: Preset, nextRange: { start: string; end: string }) => {
    saveSelection({ preset: nextPreset, start: nextRange.start, end: nextRange.end, compare })
  }
  const applyCompare = (mode: CompareMode) => {
    saveSelection({ preset, start: range.start, end: range.end, compare: mode })
  }

  const selLabel = preset === "today" ? "Today" : preset === "yesterday" ? "Yesterday" : rangeLabel(range.start, range.end)
  const compWindow = resolveComparison(compare, range.start, range.end)
  const compLabel = compareModeLabel(compare, range.start, range.end)

  const chartData = useMemo(() => {
    if (!data?.selected) return []
    const cumulate = (series: SeriesPoint[], buckets: string[]) => {
      const byX = new Map(series.map((p) => [p.x, p.net]))
      let run = 0
      return buckets.map((b) => +(run += byX.get(b) ?? 0).toFixed(2))
    }
    if (data.granularity === "hourly") {
      const buckets = Array.from({ length: 24 }, (_, h) => String(h))
      // Cut the selected line at the current store-local hour when viewing today.
      const isToday = data.selection.end === data.today
      const nowHour = Number(
        new Intl.DateTimeFormat("en-US", { timeZone: data.store.timezone, hour: "numeric", hourCycle: "h23" }).format(new Date())
      )
      const sel = cumulate(data.selected.series, buckets)
      const selCut = isToday ? buckets.map((b, i) => (Number(b) > nowHour ? null : sel[i])) : sel
      const comp = data.compareData?.hasData ? cumulate(data.compareData.series, buckets) : []
      return buckets
        .map((b, i) => ({ label: hourLabel(Number(b)), sel: selCut[i], comp: comp[i] ?? null }))
        .filter((_, h) => h >= 6) // stores aren't open at 3am — start the axis at 6a
    }
    const selBuckets = data.selected.series.map((p) => p.x)
    const sel = cumulate(data.selected.series, selBuckets)
    const compSeries = data.compareData?.hasData ? data.compareData.series : []
    let compRun = 0
    const comp = compSeries.map((p) => +(compRun += p.net).toFixed(2))
    return selBuckets.map((b, i) => ({ label: fmtDay(b), sel: sel[i], comp: comp[i] ?? null }))
  }, [data])

  if (loading && !result) return <Skeleton className="h-64 w-full" />

  const selected = data?.selected
  const compareData = data?.compareData
  const hasCompare = !!compareData?.hasData

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[15px] font-bold text-[var(--color-foreground)]">Sales Performance</p>
          <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
            {selLabel} vs {compLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <DatePicker preset={preset} range={range} onApply={applySelection} />
          <ComparePicker range={range} compare={compare} onChange={applyCompare} />
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data ? (
          <div className="py-4 flex flex-col items-start gap-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Couldn&apos;t load sales data — the request failed or timed out.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setResult(null)
                setRetryTick((t) => t + 1)
              }}
            >
              Retry
            </Button>
          </div>
        ) : !data.salesAvailable ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">Connect Square to see sales</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Link this store to a Square location (and activate the Inventory module) to light up live sales.
            </p>
            {/* R1 (Gary, 2026-08-19): a disconnect degrades the overlay, it never
                removes it. The mirrored timecards Froot already holds still
                render here, stale and stamped, rather than vanishing with the
                sales block. */}
            {data.labor && (
              <div className="mt-4 w-full max-w-[220px] text-left">
                <LaborPctMetric block={data.labor} />
                <LaborNotes block={data.labor} timeZone={data.store.timezone} />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-6 mb-3">
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                  {preset === "today" ? "Today so far" : selLabel}
                </p>
                <p className="text-3xl font-extrabold text-[var(--color-foreground)]">{usd(selected?.net ?? 0)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                  {compLabel} · {rangeLabel(compWindow.start, compWindow.end)}
                </p>
                <p className="text-3xl font-extrabold text-[var(--color-muted-foreground)]/60">
                  {hasCompare ? usd(compareData!.net) : "—"}
                </p>
              </div>
              <DeltaPill value={selected?.net ?? 0} baseline={hasCompare ? compareData!.net : null} />
            </div>

            {range.end === data.today && (selected?.unconfirmed ?? 0) > 0 && (
              <div
                className="flex items-center gap-1.5 mb-3 text-[12px] font-medium text-[#a36a00]"
                title="These sales are paid and already counted in Today's total, but their tickets are still open in Square. They finalize automatically as orders close — or confirm them in the POS."
              >
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {usd(selected!.unconfirmed, 2)} in sales not confirmed in POS
                </span>
              </div>
            )}

            {selected?.hasData || hasCompare ? (
              <>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={data.granularity === "hourly" ? 2 : "preserveStartEnd"} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={44}
                        tickFormatter={(v: number) => (Math.abs(v) >= 10000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
                      />
                      <ChartTooltip formatter={(v) => usd(Number(v), 2)} />
                      <Line type="monotone" dataKey="comp" name={compLabel} stroke="#D8CBBF" strokeWidth={3} dot={false} connectNulls />
                      <Line type="monotone" dataKey="sel" name={selLabel} stroke="var(--color-primary)" strokeWidth={3} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex gap-4 mt-1">
                  <LegendDot color="var(--color-primary)" label={selLabel} />
                  <LegendDot
                    color="#D8CBBF"
                    label={hasCompare ? `${compLabel} (${rangeLabel(compWindow.start, compWindow.end)})` : "No data for comparison period"}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)] py-4">
                {range.end === data.today
                  ? "No sales recorded yet today — the pace chart fills in as orders close."
                  : "No sales recorded for this period."}
              </p>
            )}

            <div
              className={`grid ${data.labor ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"} gap-3 border-t border-[var(--color-border)] mt-3 pt-3`}
            >
              <MiniMetric
                label="Gross sales"
                value={usd(selected?.gross ?? 0)}
                current={selected?.gross ?? 0}
                baseline={hasCompare ? compareData!.gross : null}
              />
              <MiniMetric
                label="Transactions"
                value={(selected?.orders ?? 0).toLocaleString("en-US")}
                current={selected?.orders ?? 0}
                baseline={hasCompare ? compareData!.orders : null}
              />
              <MiniMetric
                label="Average sale"
                value={usd(selected?.avgSale, 2)}
                current={selected?.avgSale ?? 0}
                baseline={hasCompare ? compareData!.avgSale : null}
              />
              {/* AL-2 feature 1 — labor % beside gross sales / transactions /
                  average sale, over the SAME window the picker above selected.
                  No comparison pill: a labor % is judged against BUDGET, not
                  against last year, and a delta arrow beside a verdict colour
                  would be two judgments of one number. */}
              {data.labor && <LaborPctMetric block={data.labor} />}
            </div>
            {data.labor && <LaborNotes block={data.labor} timeZone={data.store.timezone} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function ComparePicker({
  range,
  compare,
  onChange,
}: {
  range: { start: string; end: string }
  compare: CompareMode
  onChange: (mode: CompareMode) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Change comparison period">
          <PickerPill prefix="vs" label={compareModeLabel(compare, range.start, range.end)} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-1.5 w-72">
        {COMPARE_MODES.map((mode) => {
          const w = resolveComparison(mode, range.start, range.end)
          return (
            <button
              key={mode}
              type="button"
              onClick={() => {
                onChange(mode)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-2 text-[13px] hover:bg-[var(--color-accent)] ${
                compare === mode ? "bg-[var(--color-muted)] font-semibold" : ""
              }`}
            >
              <span className="text-[var(--color-foreground)]">{compareModeLabel(mode, range.start, range.end)}</span>
              <span className="text-[var(--color-muted-foreground)]">{rangeLabel(w.start, w.end)}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function DeltaPill({ value, baseline, small = false }: { value: number; baseline: number | null; small?: boolean }) {
  if (!baseline || baseline <= 0) return null
  const delta = ((value - baseline) / baseline) * 100
  const up = delta >= 0
  return (
    <span
      className={`${small ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"} rounded-full font-bold ${
        up
          ? "bg-[var(--color-success-bg,#e6f6e9)] text-[var(--color-success-text,#1d7c2e)]"
          : "bg-[var(--color-warning-bg,#fdf3e0)] text-[var(--color-warning-text,#a36a00)]"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

function MiniMetric({
  label,
  value,
  current,
  baseline,
}: {
  label: string
  value: string
  current: number
  baseline: number | null
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className="text-[15px] font-extrabold text-[var(--color-foreground)]">{value}</p>
        <DeltaPill value={current} baseline={baseline} small />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
