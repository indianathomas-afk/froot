"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Users, ShieldCheck, ShieldAlert, CircleAlert, CloudRain } from "lucide-react"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceArea } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useSalesViewedDay } from "./sales-performance-card"

// Labor Coverage card (Dashboard, Phase 2B — "Recommended · guidance"). A
// rule-based headcount step line for the viewed day: min-staffing floors +
// supervisor rule against StoreHours + dayparts, respecting the day's
// adjustment. Demand shape is the SalesHourlyCache (same source as the Sales
// card). Single headcount axis. ADMIN/MANAGER can set a ±% weather adjustment.

type CoveragePoint = { hour: number; headcount: number; open: boolean }
type DaypartCoverage = { name: string; minHeadcount: number; requiresSupervisor: boolean; metMin: boolean }

type CoverageResponse = {
  today: string
  date: string
  available: boolean
  canManage: boolean
  hasForecast: boolean
  hasShape: boolean
  adjustment: { adjustmentPct: number; reason: string | null } | null
  coverage: {
    points: CoveragePoint[]
    peakHours: number[]
    peakHeadcount: number
    dayHours: number
    usedPersonHours: number
    exceedsDayHours: boolean
    supervisorShortfall: boolean
    dayparts: DaypartCoverage[]
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
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export function LaborCoverageCard({ storeId }: { storeId: string }) {
  const viewedDay = useSalesViewedDay()
  const [data, setData] = useState<{ key: string; res: CoverageResponse | null } | null>(null)
  const [editing, setEditing] = useState(false)

  const key = `${storeId}|${viewedDay ?? "today"}`
  const load = useCallback(() => {
    if (!storeId) return
    const q = viewedDay ? `&date=${viewedDay}` : ""
    fetch(`/api/labor/coverage?storeId=${storeId}${q}`)
      .then((r): Promise<CoverageResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => setData({ key, res }))
      .catch(() => setData({ key, res: null }))
  }, [storeId, viewedDay, key])

  useEffect(() => {
    load()
    const onChange = () => load()
    window.addEventListener("froot-labor-changed", onChange)
    return () => window.removeEventListener("froot-labor-changed", onChange)
  }, [load])

  const loading = !data || data.key !== key
  const res = data?.res ?? null

  const chart = useMemo(() => {
    if (!res?.coverage) return { rows: [] as { label: string; headcount: number | null }[], peakStart: null as string | null, peakEnd: null as string | null, maxHead: 0 }
    const pts = res.coverage.points.filter((p) => p.hour >= 6)
    const rows = pts.map((p) => ({ label: hourLabel(p.hour), headcount: p.open ? p.headcount : null }))
    const peaks = res.coverage.peakHours.filter((h) => h >= 6)
    return {
      rows,
      peakStart: peaks.length ? hourLabel(Math.min(...peaks)) : null,
      peakEnd: peaks.length ? hourLabel(Math.max(...peaks)) : null,
      maxHead: res.coverage.peakHeadcount,
    }
  }, [res])

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

        {!res ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Couldn’t load coverage — try again in a moment.</p>
        ) : !res.hasForecast ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Set this week’s sales forecast (Labor Budget card) to see recommended coverage.</p>
        ) : !res.available ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Recommended coverage needs live hourly sales — connect Square and activate Inventory.</p>
        ) : !hasChart ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">No hourly sales shape for {dayLabel(res.date, res.today)} yet — the recommendation fills in as sales record.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[12.5px] text-[var(--color-muted-foreground)]">
                Suggested staff on floor · {dayLabel(res.date, res.today)}
                {chart.peakStart ? ` · peak ${chart.peakStart}${chart.peakEnd && chart.peakEnd !== chart.peakStart ? `–${chart.peakEnd}` : ""}` : ""}
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

            {cov && (cov.supervisorShortfall || cov.exceedsDayHours) && (
              <div className="flex flex-col gap-1 mb-2">
                {cov.supervisorShortfall && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#b42318]">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> A shift needs a supervisor but no supervisory position is defined.
                  </div>
                )}
                {cov.exceedsDayHours && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#a36a00]">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" /> Minimum staffing exceeds the day’s budgeted hours ({cov.usedPersonHours} vs {cov.dayHours.toFixed(1)}).
                  </div>
                )}
              </div>
            )}

            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows}>
                  {chart.peakStart && <ReferenceArea x1={chart.peakStart} x2={chart.peakEnd ?? chart.peakStart} fill="var(--color-primary)" fillOpacity={0.08} />}
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} width={28} allowDecimals={false} domain={[0, Math.max(2, chart.maxHead + 1)]} />
                  <ChartTooltip formatter={(v) => [`${v} on floor`, "Recommended"]} />
                  <Line type="stepAfter" dataKey="headcount" stroke="var(--color-primary)" strokeWidth={3} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {cov && cov.dayparts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {cov.dayparts.map((d) => (
                  <span
                    key={d.name}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 ${d.metMin ? "bg-[var(--color-muted)] text-[var(--color-foreground)]" : "bg-[#fdecea] text-[#b42318]"}`}
                    title={`Min ${d.minHeadcount}${d.requiresSupervisor ? " · supervisor" : ""}`}
                  >
                    {d.requiresSupervisor && <ShieldCheck className="h-3 w-3" />}
                    {d.name} · min {d.minHeadcount}
                  </span>
                ))}
              </div>
            )}

            <p className="text-[11px] text-[var(--color-muted-foreground)] mt-2">
              A guide from the weekly budget shaped by this day’s sales — not a schedule. Floor of 1 while open; salaried excluded.
            </p>
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
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Scale this day’s hourly hours up or down for conditions like weather. Salaried is unaffected.
          </p>
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
          {current && (
            <Button variant="outline" onClick={clear} disabled={saving} className="mr-auto">Remove</Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
