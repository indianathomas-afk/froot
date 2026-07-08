"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { ChevronDown } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer } from "recharts"

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
  hasData: boolean
  series: SeriesPoint[]
}

type SalesResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  salesAvailable: boolean
  selection: { start: string; end: string }
  comparison: { start: string; end: string; mode: CompareMode }
  granularity: "hourly" | "daily"
  selected: WindowData | null
  compareData: WindowData | null
}

const COMPARE_MODES = [
  "prior_period",
  "same_weekday_last_year",
  "four_weeks_prior",
  "fifty_two_weeks_prior",
  "prior_year",
] as const
type CompareMode = (typeof COMPARE_MODES)[number]

const PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "custom",
] as const
type Preset = (typeof PRESETS)[number]

const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  last_year: "Last year",
  custom: "Custom",
}

// ─── Local-date helpers (yyyy-mm-dd strings, browser-local calendar) ─────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fromDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function shiftDateStr(dateStr: string, days: number): string {
  const d = fromDateStr(dateStr)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

function priorCalendarYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y - 1, m - 1, d)
  if (dt.getMonth() !== m - 1) dt.setDate(0) // Feb 29 → Feb 28
  return toDateStr(dt)
}

function daysInclusive(start: string, end: string): number {
  return Math.round((fromDateStr(end).getTime() - fromDateStr(start).getTime()) / 86400000) + 1
}

// Weeks start Sunday (matches the Square calendar the design mirrors).
function resolvePreset(preset: Exclude<Preset, "custom">): { start: string; end: string } {
  const now = new Date()
  const t = toDateStr(now)
  switch (preset) {
    case "today":
      return { start: t, end: t }
    case "yesterday": {
      const y = shiftDateStr(t, -1)
      return { start: y, end: y }
    }
    case "this_week": {
      const start = shiftDateStr(t, -now.getDay())
      return { start, end: t }
    }
    case "last_week": {
      const thisWeekStart = shiftDateStr(t, -now.getDay())
      return { start: shiftDateStr(thisWeekStart, -7), end: shiftDateStr(thisWeekStart, -1) }
    }
    case "this_month":
      return { start: `${t.slice(0, 7)}-01`, end: t }
    case "last_month": {
      const firstOfThis = fromDateStr(`${t.slice(0, 7)}-01`)
      const lastOfPrev = new Date(firstOfThis.getFullYear(), firstOfThis.getMonth(), 0)
      return { start: `${toDateStr(lastOfPrev).slice(0, 7)}-01`, end: toDateStr(lastOfPrev) }
    }
    case "this_year":
      return { start: `${t.slice(0, 4)}-01-01`, end: t }
    case "last_year": {
      const y = Number(t.slice(0, 4)) - 1
      return { start: `${y}-01-01`, end: `${y}-12-31` }
    }
  }
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

function fmtDay(dateStr: string, withYear = false): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  })
}

function weekdayShort(dateStr: string): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", { weekday: "short" })
}

function rangeLabel(start: string, end: string): string {
  const thisYear = String(new Date().getFullYear())
  const withYear = start.slice(0, 4) !== thisYear || end.slice(0, 4) !== thisYear
  if (start === end) return fmtDay(start, withYear)
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmtDay(start)}–${Number(end.slice(8, 10))}${withYear ? `, ${end.slice(0, 4)}` : ""}`
  }
  return `${fmtDay(start, withYear)} – ${fmtDay(end, withYear)}`
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
  const requestSeq = useRef(0)
  const requestKey = `${storeId}|${range.start}|${range.end}|${compare}`

  useEffect(() => {
    if (!storeId) return
    const seq = ++requestSeq.current
    const key = `${storeId}|${range.start}|${range.end}|${compare}`
    fetch(`/api/dashboard/sales?storeId=${storeId}&start=${range.start}&end=${range.end}&compare=${compare}`)
      .then((res): Promise<SalesResponse | null> => (res.ok ? res.json() : Promise.resolve(null)))
      .then((json) => {
        if (seq === requestSeq.current) setResult({ key, data: json })
      })
      .catch(() => {
        if (seq === requestSeq.current) setResult({ key, data: null })
      })
  }, [storeId, range.start, range.end, compare])

  const loading = !result || result.key !== requestKey
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
          <p className="text-sm text-[var(--color-muted-foreground)] py-4">
            Couldn&apos;t load sales data — try again in a moment.
          </p>
        ) : !data.salesAvailable ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">Connect Square to see sales</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Link this store to a Square location (and activate the Inventory module) to light up live sales.
            </p>
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

            <div className="grid grid-cols-3 gap-3 border-t border-[var(--color-border)] mt-3 pt-3">
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
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function PickerPill({ prefix, label }: { prefix: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-[var(--color-input)] px-2.5 h-8 text-[13px] hover:bg-[var(--color-accent)] cursor-pointer">
      <span className="text-[var(--color-muted-foreground)]">{prefix}</span>
      <span className="font-semibold text-[var(--color-foreground)]">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
    </span>
  )
}

function DatePicker({
  preset,
  range,
  onApply,
}: {
  preset: Preset
  range: { start: string; end: string }
  onApply: (preset: Preset, range: { start: string; end: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  const pillLabel =
    preset === "today" || preset === "yesterday" ? PRESET_LABELS[preset] : rangeLabel(range.start, range.end)

  const openChange = (o: boolean) => {
    setOpen(o)
    if (o) setDraft({ from: fromDateStr(range.start), to: fromDateStr(range.end) })
  }

  const applyDraft = () => {
    if (!draft?.from) return
    const from = draft.from
    const to = draft.to ?? draft.from
    onApply("custom", { start: toDateStr(from), end: toDateStr(to) })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Change date range">
          <PickerPill prefix="Date" label={pillLabel} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-auto">
        <div className="flex">
          <div className="flex flex-col border-r border-[var(--color-border)] p-2 min-w-[120px]">
            {(PRESETS.filter((p) => p !== "custom") as Exclude<Preset, "custom">[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onApply(p, resolvePreset(p))
                  setOpen(false)
                }}
                className={`text-left text-[13px] rounded-md px-2.5 py-1.5 hover:bg-[var(--color-accent)] ${
                  preset === p ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-foreground)]"
                }`}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
            <span className={`text-left text-[13px] px-2.5 py-1.5 ${preset === "custom" ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"}`}>
              Custom
            </span>
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={draft}
              onSelect={setDraft}
              defaultMonth={fromDateStr(range.start)}
              disabled={{ after: new Date() }}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {draft?.from ? rangeLabel(toDateStr(draft.from), toDateStr(draft.to ?? draft.from)) : "Pick a day or range"}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={applyDraft} disabled={!draft?.from}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

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
