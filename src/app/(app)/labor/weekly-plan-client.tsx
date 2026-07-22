"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarRange, ChevronLeft, ChevronRight, CloudRain, Crown, ShieldAlert, CircleAlert, Sliders } from "lucide-react"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceArea } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// ── date helpers (client-local, weeks start Monday) ──────────────────────────
const pad = (n: number) => String(n).padStart(2, "0")
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}
const mondayOf = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay()
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow))
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}
const usd = (n: number, d = 0) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d })
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
function hourLabel(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

type PlanDay = {
  date: string
  weekday: number
  isToday: boolean
  isPast: boolean
  closed: boolean
  open: { startHour: number; endHour: number } | null
  forecastSales: number | null
  lastYearSales: number | null
  lastYearDelta: number | null
  hoursAllocated: number
  floorHours: number
  baseHourlyHours: number
  overrideHours: number | null
  splitHourlyHours: number
  adjustmentPct: number
  adjustmentReason: string | null
  gmWindow: { startHour: number; endHour: number } | null
  status: "closed" | "under" | "tight" | "slack" | "ok"
}
type WeekResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  weekStart: string
  canManage: boolean
  policy: "FLOOR_FIRST" | "SALES_WEIGHTED"
  target: number
  hasForecast: boolean
  weekly: {
    forecastTotal: number | null
    forecastSource: "MANUAL" | "TREND" | null
    hourlyHours: number
    salariedHours: number
    totalSchedulableHours: number
    adjustedTotalSchedulableHours: number
    projectedLaborPctAtForecast: number | null
    floorExceedsBudget: boolean
    overrideTotal: number | null
  } | null
  days: PlanDay[]
}

const STATUS: Record<PlanDay["status"], { dot: string; label: string; text: string }> = {
  ok: { dot: "var(--color-success)", label: "OK", text: "text-[#1d7c2e]" },
  tight: { dot: "var(--color-warning)", label: "Tight", text: "text-[#a36a00]" },
  under: { dot: "#e5484d", label: "Under", text: "text-[#b42318]" },
  slack: { dot: "var(--color-info)", label: "Slack", text: "text-[#0369a1]" },
  closed: { dot: "var(--color-muted-foreground)", label: "Closed", text: "text-[var(--color-muted-foreground)]" },
}

export function WeeklyPlanClient({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayStr()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [data, setData] = useState<{ key: string; res: WeekResponse | null } | null>(null)

  const key = `${storeId}|${weekStart}`
  const load = useCallback(() => {
    if (!storeId) return
    fetch(`/api/labor/weekly-plan?storeId=${storeId}&weekStart=${weekStart}`)
      .then((r): Promise<WeekResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => setData({ key, res }))
      .catch(() => setData({ key, res: null }))
  }, [storeId, weekStart, key])

  useEffect(() => {
    load()
    const onChange = () => load()
    window.addEventListener("froot-labor-changed", onChange)
    return () => window.removeEventListener("froot-labor-changed", onChange)
  }, [load])

  const loading = !data || data.key !== key
  const res = data?.res ?? null

  // Default the selected day to today if it's in the viewed week, else Monday.
  useEffect(() => {
    if (!res?.days.length) return
    const inWeek = res.days.some((d) => d.date === selectedDate)
    if (!inWeek) {
      const t = res.days.find((d) => d.isToday)
      setSelectedDate(t?.date ?? res.days[0].date)
    }
  }, [res, selectedDate])

  const weekLabel = useMemo(() => {
    const [y, m, d] = weekStart.split("-").map(Number)
    const start = new Date(y, m - 1, d)
    const end = new Date(y, m - 1, d + 6)
    const f = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    return `${f(start)} – ${f(end)}`
  }, [weekStart])

  const selected = res?.days.find((d) => d.date === selectedDate) ?? null

  return (
    <div>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-[var(--color-primary)]" />
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Weekly Plan</h1>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Everything you need to write the week&apos;s schedule — forecast, hours, and recommended coverage in one view.
          </p>
        </div>
        {stores.length > 1 && (
          <Select value={storeId} onValueChange={(v) => { setStoreId(v); setSelectedDate(null) }}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Select store" /></SelectTrigger>
            <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      {/* Week navigator */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setWeekStart(mondayOf(addDays(weekStart, -7)))} className="p-1.5 rounded hover:bg-[var(--color-accent)]" aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-[var(--color-foreground)] min-w-[150px] text-center">{weekLabel}</span>
        <button
          onClick={() => setWeekStart(mondayOf(addDays(weekStart, 7)))}
          disabled={weekStart >= mondayOf(addDays(todayStr(), 28))}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-40"
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {weekStart !== mondayOf(todayStr()) && (
          <button onClick={() => setWeekStart(mondayOf(todayStr()))} className="text-xs text-[var(--color-primary)] hover:underline ml-1">this week</button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : !res ? (
        <Card><CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">Couldn&apos;t load the weekly plan — try again in a moment.</CardContent></Card>
      ) : !res.hasForecast || !res.weekly ? (
        <Card><CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
          No sales forecast for this week yet. Set up sales goals in Forecasting (or enter a manual weekly total on the dashboard Labor Budget card) to plan the week.
        </CardContent></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <WeekOverview res={res} selectedDate={selectedDate} onSelect={setSelectedDate} />
          {res.canManage && <Rebalancer res={res} onSaved={load} />}
          {selected && <DayDetail storeId={storeId} day={selected} target={res.target} />}
        </div>
      )}
    </div>
  )
}

// ── Layer 1: week overview strip ─────────────────────────────────────────────
function WeekOverview({ res, selectedDate, onSelect }: { res: WeekResponse; selectedDate: string | null; onSelect: (d: string) => void }) {
  const w = res.weekly!
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-[var(--color-muted-foreground)]">
              Forecast <span className="font-semibold text-[var(--color-foreground)]">{w.forecastTotal != null ? usd(w.forecastTotal) : "—"}</span>
              {w.forecastSource && <span className="text-[11px] uppercase tracking-wide ml-1">· {w.forecastSource === "MANUAL" ? "manual" : "auto"}</span>}
            </span>
            <span className="text-[13px] text-[var(--color-muted-foreground)]">
              Schedulable <span className="font-semibold text-[var(--color-foreground)]">{w.adjustedTotalSchedulableHours.toFixed(1)} hrs</span>
            </span>
            <span className="text-[13px] text-[var(--color-muted-foreground)]">
              Projected <span className="font-semibold text-[var(--color-foreground)]">{w.projectedLaborPctAtForecast != null ? `${w.projectedLaborPctAtForecast.toFixed(1)}%` : "—"}</span>
              <span className="text-[11px] ml-1">/ target {res.target.toFixed(1)}%</span>
            </span>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            {res.policy === "FLOOR_FIRST" ? "Floor-first split" : "Sales-weighted split"}
          </span>
        </div>

        {w.floorExceedsBudget && (
          <div className="flex items-start gap-1.5 mb-3 text-[12px] font-medium text-[#b42318] bg-[#fdecea] rounded-md px-2 py-1.5">
            <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Salaried pay alone exceeds this week&apos;s budget — no hours left for hourly staff.</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {res.days.map((d) => {
            const s = STATUS[d.status]
            const sel = d.date === selectedDate
            return (
              <button
                key={d.date}
                onClick={() => onSelect(d.date)}
                className={`text-left rounded-lg border p-2.5 transition-colors ${sel ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-[var(--color-foreground)]">{WD[d.weekday]}{d.isToday ? " ·" : ""}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: s.dot }} title={s.label}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.dot }} /> {s.label}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--color-muted-foreground)] mb-1.5">{d.date.slice(5)}</div>
                {d.closed ? (
                  <div className="text-[12px] text-[var(--color-muted-foreground)] py-2">Closed</div>
                ) : (
                  <>
                    <div className="text-[13px] font-semibold text-[var(--color-foreground)]">{d.forecastSales != null ? usd(d.forecastSales) : "—"}</div>
                    {d.lastYearDelta != null && (
                      <div className={`text-[10.5px] ${d.lastYearDelta >= 0 ? "text-[#1d7c2e]" : "text-[#b42318]"}`}>
                        {d.lastYearDelta >= 0 ? "▲" : "▼"} {usd(Math.abs(d.lastYearDelta))} vs LY
                      </div>
                    )}
                    <div className="text-[11.5px] text-[var(--color-muted-foreground)] mt-1.5">
                      <span className="font-semibold text-[var(--color-foreground)]">{d.hoursAllocated.toFixed(1)}</span> hrs
                      {d.overrideHours != null && <span className="text-[var(--color-primary)]" title="Rebalanced"> · pinned</span>}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted-foreground)] flex items-center gap-1 flex-wrap">
                      {d.adjustmentPct !== 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[#a36a00]" title={d.adjustmentReason ?? "weather adjustment"}>
                          <CloudRain className="h-3 w-3" />{d.adjustmentPct > 0 ? "+" : ""}{d.adjustmentPct}%
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
            )
          })}
        </div>
        {res.days.some((d) => d.status === "slack") && res.policy === "SALES_WEIGHTED" && (
          <p className="text-[11px] text-[var(--color-muted-foreground)] mt-2">Slow-but-open days may be flagged — switch to floor-first in Settings → Labor, or rebalance below.</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Rebalancer (L-3B) ────────────────────────────────────────────────────────
function Rebalancer({ res, onSaved }: { res: WeekResponse; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const weekly = res.weekly!
  const openDays = res.days.filter((d) => !d.closed)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Seed from the current plan whenever it changes.
  useEffect(() => {
    const e: Record<string, string> = {}
    const p = new Set<string>()
    for (const d of res.days) {
      e[d.date] = (d.overrideHours ?? d.splitHourlyHours).toFixed(1)
      if (d.overrideHours != null) p.add(d.date)
    }
    setEdits(e)
    setPinned(p)
    setErr(null)
  }, [res])

  const pinnedSum = [...pinned].reduce((s, date) => s + (Number(edits[date]) || 0), 0)
  const remaining = +(weekly.hourlyHours - pinnedSum).toFixed(1)

  function setDay(date: string, val: string) {
    setEdits((e) => ({ ...e, [date]: val }))
    setPinned((p) => new Set(p).add(date))
  }
  function unpin(date: string) {
    setPinned((p) => { const n = new Set(p); n.delete(date); return n })
    const base = res.days.find((d) => d.date === date)
    setEdits((e) => ({ ...e, [date]: (base?.baseHourlyHours ?? 0).toFixed(1) }))
  }

  async function save() {
    const overrides = [...pinned].map((date) => ({ date, hours: Number(edits[date]) }))
    if (overrides.some((o) => !(o.hours >= 0))) return setErr("Enter valid hours (0 or more) for every pinned day.")
    if (pinnedSum > weekly.hourlyHours + 0.5) return setErr(`Pinned hours (${pinnedSum.toFixed(1)}) exceed the week's hourly budget (${weekly.hourlyHours.toFixed(1)}).`)
    setSaving(true)
    setErr(null)
    const r = await fetch("/api/labor/day-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: res.store.id, weekStart: res.weekStart, overrides }),
    }).catch(() => null)
    setSaving(false)
    if (!r?.ok) { const j = await r?.json().catch(() => null); return setErr(j?.error ?? "Couldn't save — try again.") }
    onSaved()
    window.dispatchEvent(new Event("froot-labor-changed"))
  }
  async function resetWeek() {
    setSaving(true)
    const r = await fetch(`/api/labor/day-hours?storeId=${res.store.id}&weekStart=${res.weekStart}`, { method: "DELETE" }).catch(() => null)
    setSaving(false)
    if (r?.ok) { onSaved(); window.dispatchEvent(new Event("froot-labor-changed")) }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <button className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-foreground)]" onClick={() => setOpen((o) => !o)}>
          <Sliders className="h-4 w-4 text-[var(--color-primary)]" /> Rebalance hours across the week
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {open && (
          <div className="mt-3">
            <p className="text-[12px] text-[var(--color-muted-foreground)] mb-3">
              Pin a day&apos;s hours to move staffing between days. Unpinned days share whatever hours are left using the floor-first split. Total can&apos;t exceed the week&apos;s hourly budget.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
              {openDays.map((d) => {
                const isPinned = pinned.has(d.date)
                return (
                  <div key={d.date} className={`rounded-lg border p-2 ${isPinned ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-bold text-[var(--color-foreground)]">{WD[d.weekday]}</span>
                      {isPinned ? (
                        <button className="text-[10px] text-[var(--color-primary)] hover:underline" onClick={() => unpin(d.date)}>auto</button>
                      ) : (
                        <span className="text-[10px] text-[var(--color-muted-foreground)]">auto</span>
                      )}
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      value={edits[d.date] ?? ""}
                      onChange={(e) => setDay(d.date, e.target.value)}
                      className="h-8 text-[13px]"
                    />
                    <div className="text-[10px] text-[var(--color-muted-foreground)] mt-1">floor {d.floorHours.toFixed(1)}</div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[12.5px] font-semibold ${remaining < -0.5 ? "text-[#b42318]" : "text-[var(--color-muted-foreground)]"}`}>
                {remaining >= 0 ? `${remaining.toFixed(1)} hrs left to distribute` : `${Math.abs(remaining).toFixed(1)} hrs over budget`}
              </span>
              <span className="text-[11px] text-[var(--color-muted-foreground)]">weekly hourly budget {weekly.hourlyHours.toFixed(1)} hrs</span>
              <div className="ml-auto flex items-center gap-2">
                {weekly.overrideTotal != null && <Button variant="outline" size="sm" onClick={resetWeek} disabled={saving}>Reset week</Button>}
                <Button size="sm" onClick={save} disabled={saving || pinned.size === 0}>{saving ? "Saving…" : "Save"}</Button>
              </div>
            </div>
            {err && <p className="text-[12px] text-[var(--color-destructive)] mt-2">{err}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Layer 2: selected-day detail (reuses /api/labor/coverage) ────────────────
type CoveragePoint = { hour: number; headcount: number; hourly: number; gm: boolean; open: boolean }
type CoverageResponse = {
  date: string
  hasForecast: boolean
  hasShape: boolean
  available: boolean
  coverage: {
    points: CoveragePoint[]
    peakHours: number[]
    peakHeadcount: number
    hourlyBudgetHours: number
    usedHourlyHours: number
    understaffedBudget: boolean
    gmWindow: { startHour: number; endHour: number } | null
    supervisorGap: boolean
  } | null
}

function DayDetail({ storeId, day, target }: { storeId: string; day: PlanDay; target: number }) {
  const [data, setData] = useState<{ key: string; res: CoverageResponse | null } | null>(null)
  const key = `${storeId}|${day.date}`
  useEffect(() => {
    let active = true
    fetch(`/api/labor/coverage?storeId=${storeId}&date=${day.date}`)
      .then((r): Promise<CoverageResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => { if (active) setData({ key, res }) })
      .catch(() => { if (active) setData({ key, res: null }) })
    return () => { active = false }
  }, [storeId, day.date, key])

  const loading = !data || data.key !== key
  const res = data?.res ?? null
  const cov = res?.coverage ?? null

  const chart = useMemo(() => {
    if (!cov) return { rows: [] as { label: string; headcount: number | null }[], gmStart: null as string | null, gmEnd: null as string | null, maxHead: 0, quietHour: null as number | null }
    const pts = cov.points.filter((p) => p.hour >= 6)
    const rows = pts.map((p) => ({ label: hourLabel(p.hour), headcount: p.open ? p.headcount : null }))
    const openPts = cov.points.filter((p) => p.open)
    const minHead = openPts.length ? Math.min(...openPts.map((p) => p.headcount)) : 0
    const quiet = openPts.find((p) => p.headcount === minHead)?.hour ?? null
    return {
      rows,
      gmStart: cov.gmWindow ? hourLabel(Math.max(6, cov.gmWindow.startHour)) : null,
      gmEnd: cov.gmWindow ? hourLabel(cov.gmWindow.endHour) : null,
      maxHead: cov.peakHeadcount,
      quietHour: quiet,
    }
  }, [cov])

  const dayTitle = useMemo(() => {
    const [y, m, d] = day.date.split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
  }, [day.date])

  const hasChart = !!cov && !chart.rows.every((r) => r.headcount === null)

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-bold text-[var(--color-foreground)]">{dayTitle}</p>
            {day.adjustmentPct !== 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[var(--color-warning)]/15 text-[#a36a00]">
                <CloudRain className="h-3 w-3" />{day.adjustmentPct > 0 ? "+" : ""}{day.adjustmentPct}%{day.adjustmentReason ? ` · ${day.adjustmentReason}` : ""}
              </span>
            )}
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">Recommended · guidance</span>
        </div>

        {/* Day facts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[12.5px] mb-3">
          <span className="text-[var(--color-muted-foreground)]">Forecast</span>
          <span className="text-right font-semibold text-[var(--color-foreground)] sm:text-left">{day.forecastSales != null ? usd(day.forecastSales) : "—"}</span>
          <span className="text-[var(--color-muted-foreground)]">Last-year (same wd)</span>
          <span className="text-right font-semibold text-[var(--color-foreground)] sm:text-left">{day.lastYearSales != null ? usd(day.lastYearSales) : "—"}</span>
          <span className="text-[var(--color-muted-foreground)]">Hourly hours</span>
          <span className="text-right font-semibold text-[var(--color-foreground)] sm:text-left">{day.hoursAllocated.toFixed(1)} hrs</span>
          <span className="text-[var(--color-muted-foreground)]">Floor need</span>
          <span className="text-right font-semibold text-[var(--color-foreground)] sm:text-left">{day.floorHours.toFixed(1)} hrs</span>
        </div>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : day.closed ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Store is closed this day.</p>
        ) : !res ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Couldn&apos;t load coverage — try again in a moment.</p>
        ) : !res.available ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Recommended coverage needs hourly sales history — connect Square and activate Inventory.</p>
        ) : !hasChart ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">No sales shape to project this day yet.</p>
        ) : (
          <>
            {cov && (cov.supervisorGap || cov.understaffedBudget) && (
              <div className="flex flex-col gap-1 mb-2">
                {cov.supervisorGap && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#b42318]">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> No supervisory position covers the hours the GM is off the floor.
                  </div>
                )}
                {cov.understaffedBudget && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#a36a00]">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" /> The budget can&apos;t cover a floor of 1 all day ({cov.usedHourlyHours} hrs needed vs {cov.hourlyBudgetHours.toFixed(1)} budgeted).
                  </div>
                )}
              </div>
            )}

            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows}>
                  {chart.gmStart && <ReferenceArea x1={chart.gmStart} x2={chart.gmEnd ?? chart.gmStart} fill="var(--color-primary)" fillOpacity={0.08} label={{ value: "GM", position: "insideTop", fontSize: 9, fill: "var(--color-primary)" }} />}
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 10 }} width={28} allowDecimals={false} domain={[0, Math.max(2, chart.maxHead + 1)]} />
                  <ChartTooltip formatter={(v) => [`${v} on floor`, "Recommended"]} />
                  <Line type="stepAfter" dataKey="headcount" stroke="var(--color-primary)" strokeWidth={3} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-[var(--color-muted-foreground)]">
              {cov!.gmWindow && (
                <span className="inline-flex items-center gap-1"><Crown className="h-3 w-3 text-[var(--color-primary)]" /> GM on floor {hourLabel(cov!.gmWindow.startHour)}–{hourLabel(cov!.gmWindow.endHour)}</span>
              )}
              {cov!.peakHours.length > 0 && <span>Peak {cov!.peakHours.map(hourLabel).join(", ")} · {cov!.peakHeadcount} on floor</span>}
              {chart.quietHour != null && <span>Quietest {hourLabel(chart.quietHour)} — good break window</span>}
            </div>
            <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
              Demand-shaped and capped by the conservative budget — a guide, not a schedule. Break window is guidance only. Weekly target {target.toFixed(1)}%.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
