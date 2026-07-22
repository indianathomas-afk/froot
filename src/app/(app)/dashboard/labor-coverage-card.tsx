"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Users, ShieldAlert, CircleAlert, CloudRain, ChevronLeft, ChevronRight, Crown, CalendarRange } from "lucide-react"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceArea } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useLaborViewedDate, shiftDateStr, todayStr } from "./use-labor-date"
import { SplitPolicyInfo } from "@/components/labor/split-policy-info"

// Labor Coverage card (Dashboard, Phase 3 — "Recommended · guidance"). A
// demand-shaped, budget-capped headcount step line for the viewed day — future
// days included (projected from recent same-weekdays). The salaried GM is
// counted on floor in their window. Single headcount axis. ADMIN/MANAGER set a
// ±% weather adjustment. Day nav (‹ ›) is shared with the Budget card.

type CoveragePoint = { hour: number; headcount: number; hourly: number; gm: boolean; open: boolean }

type CoverageResponse = {
  today: string
  date: string
  available: boolean
  canManage: boolean
  hasForecast: boolean
  hasShape: boolean
  isFuture: boolean
  adjustment: { adjustmentPct: number; reason: string | null } | null
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

function hourLabel(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}
function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "today"
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  const base = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  return dateStr > today ? base : base
}

export function LaborCoverageCard({ storeId }: { storeId: string }) {
  const [viewedDate, setViewedDate] = useLaborViewedDate()
  const [data, setData] = useState<{ key: string; res: CoverageResponse | null } | null>(null)
  const [editing, setEditing] = useState(false)

  const key = `${storeId}|${viewedDate}`
  const load = useCallback(() => {
    if (!storeId) return
    fetch(`/api/labor/coverage?storeId=${storeId}&date=${viewedDate}`)
      .then((r): Promise<CoverageResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => setData({ key, res }))
      .catch(() => setData({ key, res: null }))
  }, [storeId, viewedDate, key])

  useEffect(() => {
    load()
    const onChange = () => load()
    window.addEventListener("froot-labor-changed", onChange)
    return () => window.removeEventListener("froot-labor-changed", onChange)
  }, [load])

  const loading = !data || data.key !== key
  const res = data?.res ?? null

  const chart = useMemo(() => {
    if (!res?.coverage) return { rows: [] as { label: string; headcount: number | null }[], gmStart: null as string | null, gmEnd: null as string | null, maxHead: 0 }
    const pts = res.coverage.points.filter((p) => p.hour >= 6)
    const rows = pts.map((p) => ({ label: hourLabel(p.hour), headcount: p.open ? p.headcount : null }))
    const gm = res.coverage.gmWindow
    return {
      rows,
      gmStart: gm ? hourLabel(Math.max(6, gm.startHour)) : null,
      gmEnd: gm ? hourLabel(gm.endHour) : null,
      maxHead: res.coverage.peakHeadcount,
    }
  }, [res])

  const canGoBack = viewedDate > shiftDateStr(todayStr(), -60)
  const canGoFwd = viewedDate < shiftDateStr(todayStr(), 28)

  if (loading) return <Skeleton className="h-56 w-full" />

  const cov = res?.coverage
  const hasChart = !!cov && !chart.rows.every((r) => r.headcount === null)

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-[var(--color-primary)]" />
            <p className="text-[15px] font-bold text-[var(--color-foreground)]">Labor Coverage</p>
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-primary)] uppercase">Recommended · guidance</span>
        </div>

        {/* Day navigator (shared with the Budget card) */}
        <div className="flex items-center gap-1.5 mb-2">
          <button onClick={() => setViewedDate(shiftDateStr(viewedDate, -1))} disabled={!canGoBack} className="p-1 rounded hover:bg-[var(--color-accent)] disabled:opacity-40" aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12.5px] font-semibold text-[var(--color-foreground)] min-w-[92px] text-center">
            {res ? dayLabel(res.date, res.today) : dayLabel(viewedDate, todayStr())}
          </span>
          <button onClick={() => setViewedDate(shiftDateStr(viewedDate, 1))} disabled={!canGoFwd} className="p-1 rounded hover:bg-[var(--color-accent)] disabled:opacity-40" aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </button>
          {res?.isFuture && <span className="text-[11px] text-[var(--color-muted-foreground)]">· projected from recent {new Date(`${res.date}T12:00`).toLocaleDateString("en-US", { weekday: "long" })}s</span>}
          {res && viewedDate !== res.today && (
            <button onClick={() => setViewedDate(todayStr())} className="text-[11px] text-[var(--color-primary)] hover:underline ml-1">today</button>
          )}
        </div>

        {!res ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Couldn’t load coverage — try again in a moment.</p>
        ) : !res.hasForecast ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">No sales forecast for this week (set one up in Forecasting) — coverage needs a budget.</p>
        ) : !res.available ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Recommended coverage needs hourly sales history — connect Square and activate Inventory.</p>
        ) : !hasChart ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">No sales shape to project {dayLabel(res.date, res.today)} yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[12.5px] text-[var(--color-muted-foreground)]">
                Suggested staff on floor{cov!.gmWindow ? " (incl. GM)" : ""}
              </p>
              <div className="flex items-center gap-2">
                {res.adjustment && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[var(--color-warning)]/15 text-[#a36a00]">
                    <CloudRain className="h-3 w-3" />
                    {res.adjustment.adjustmentPct > 0 ? "+" : ""}{res.adjustment.adjustmentPct}%{res.adjustment.reason ? ` · ${res.adjustment.reason}` : ""}
                  </span>
                )}
                {res.canManage && (
                  <button className="text-[11px] font-medium text-[var(--color-primary)] hover:underline" onClick={() => setEditing(true)}>
                    {res.adjustment ? "Edit adjustment" : "Adjust for weather"}
                  </button>
                )}
              </div>
            </div>

            {cov && (cov.supervisorGap || cov.understaffedBudget) && (
              <div className="flex flex-col gap-1 mb-2">
                {cov.supervisorGap && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#b42318]">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> No supervisory position covers the hours the GM is off the floor.
                  </div>
                )}
                {cov.understaffedBudget && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#a36a00]">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" /> The budget can’t cover a floor of 1 all day ({cov.usedHourlyHours} hrs needed vs {cov.hourlyBudgetHours.toFixed(1)} budgeted).
                    <SplitPolicyInfo />
                  </div>
                )}
              </div>
            )}

            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows}>
                  {chart.gmStart && <ReferenceArea x1={chart.gmStart} x2={chart.gmEnd ?? chart.gmStart} fill="var(--color-primary)" fillOpacity={0.08} label={{ value: "GM", position: "insideTop", fontSize: 9, fill: "var(--color-primary)" }} />}
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
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
              <span>Hourly budget {cov!.hourlyBudgetHours.toFixed(1)} hrs</span>
            </div>
            <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
              Demand-shaped and capped by the conservative budget — a guide, not a schedule. Floor of 1 while open.
            </p>
            <Link href="/labor" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline mt-2">
              <CalendarRange className="h-3.5 w-3.5" /> Open Weekly Plan
            </Link>
          </>
        )}
      </CardContent>

      {editing && res && (
        <AdjustmentDialog
          storeId={storeId}
          date={res.date}
          dateLabel={dayLabel(res.date, res.today)}
          current={res.adjustment}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
            window.dispatchEvent(new Event("froot-labor-changed"))
          }}
        />
      )}
    </Card>
  )
}

function AdjustmentDialog({
  storeId,
  date,
  dateLabel,
  current,
  onClose,
  onSaved,
}: {
  storeId: string
  date: string
  dateLabel: string
  current: { adjustmentPct: number; reason: string | null } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [pct, setPct] = useState(current ? String(current.adjustmentPct) : "-20")
  const [reason, setReason] = useState(current?.reason ?? "")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(pct)
    if (!(n >= -100 && n <= 100) || pct.trim() === "") return setErr("Enter a percent between -100 and 100.")
    setSaving(true)
    setErr(null)
    const res = await fetch("/api/labor/day-adjustment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, date, adjustmentPct: n, reason: reason.trim() || null }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) return setErr("Couldn’t save — try again.")
    onSaved()
  }
  async function clear() {
    setSaving(true)
    const res = await fetch(`/api/labor/day-adjustment?storeId=${storeId}&date=${date}`, { method: "DELETE" }).catch(() => null)
    setSaving(false)
    if (res?.ok) onSaved()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Labor adjustment · {dateLabel}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-sm text-[var(--color-muted-foreground)]">Scale this day’s hourly hours up or down for conditions like weather. Salaried is unaffected.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="a-pct">Adjustment (%)</Label>
              <Input id="a-pct" type="number" min="-100" max="100" step="5" value={pct} onChange={(e) => setPct(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="a-reason">Reason</Label>
              <Input id="a-reason" placeholder="e.g. Rain" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-sm text-[var(--color-destructive)]">{err}</p>}
        </div>
        <DialogFooter>
          {current && <Button variant="outline" onClick={clear} disabled={saving} className="mr-auto">Remove</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
