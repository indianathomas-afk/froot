"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { CircleAlert, Clock, Sparkles, Pencil, ChevronLeft, ChevronRight, CalendarRange } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fetchCard } from "./card-fetch"
import { useLaborViewedDate, shiftDateStr, todayStr } from "./use-labor-date"

// Labor Budget hero card (Dashboard). Phase 2: the week's projected sales are
// AUTO-DERIVED from Forecasting (no data entry) — GET /api/labor/budget returns
// source "TREND" (from the forecast) or "MANUAL" (an operator override). Total
// sales only. Per-day adjustments (set on the Coverage card) scale hourly hours;
// the hero shows the adjusted weekly total and lists the adjusted days.

type LaborBudget = {
  conservativeSales: number
  totalLaborBudget: number
  salariedCost: number
  salariedHours: number
  hourlyDollars: number
  hourlyHours: number
  totalSchedulableHours: number
  projectedLaborPctAtForecast: number | null
  floorExceedsBudget: boolean
}

type WeekAdjustment = { date: string; adjustmentPct: number; reason: string | null }

type BudgetResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  weekStart: string
  canManage: boolean
  target: number
  source: "MANUAL" | "TREND" | null
  hasForecast: boolean
  forecast: { total: number; source: "MANUAL" | "TREND" } | null
  budget: LaborBudget | null
  adjustedTotalSchedulableHours: number | null
  weekAdjustments: WeekAdjustment[]
}

const usd = (n: number, d = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d })

function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number)
  return `Week of ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}
function dayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" })
}

function zone(projected: number, target: number): { bar: string; text: string } {
  if (projected > target) return { bar: "#e5484d", text: "text-[#b42318]" }
  if (projected > target - 1) return { bar: "var(--color-warning)", text: "text-[#a36a00]" }
  return { bar: "var(--color-success)", text: "text-[#1d7c2e]" }
}

export function LaborBudgetCard({ storeId }: { storeId: string }) {
  const [viewedDate, setViewedDate] = useLaborViewedDate()
  const [data, setData] = useState<{ key: string; res: BudgetResponse | null } | null>(null)
  const [editing, setEditing] = useState(false)

  const key = `${storeId}|${viewedDate}`
  const load = useCallback(() => {
    if (!storeId) return
    fetchCard<BudgetResponse>("labor budget", `/api/labor/budget?storeId=${storeId}&weekStart=${viewedDate}`).then(
      (res) => setData({ key, res })
    )
  }, [storeId, viewedDate, key])

  useEffect(() => {
    load()
    // Reload when a sibling card changes the forecast/adjustment for this store.
    const onChange = () => load()
    window.addEventListener("froot-labor-changed", onChange)
    return () => window.removeEventListener("froot-labor-changed", onChange)
  }, [load])

  const loading = !data || data.key !== key
  if (loading) return <Skeleton className="h-64 w-full" />
  const res = data.res
  const canGoFwd = viewedDate < shiftDateStr(todayStr(), 28)

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[var(--color-primary)]" />
            <p className="text-[15px] font-bold text-[var(--color-foreground)]">Labor Budget</p>
          </div>
          {res && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setViewedDate(shiftDateStr(viewedDate, -7))} className="p-0.5 rounded hover:bg-[var(--color-accent)]" aria-label="Previous week">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase min-w-[92px] text-center">
                {weekLabel(res.weekStart)}
              </span>
              <button onClick={() => setViewedDate(shiftDateStr(viewedDate, 7))} disabled={!canGoFwd} className="p-0.5 rounded hover:bg-[var(--color-accent)] disabled:opacity-40" aria-label="Next week">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {!res ? (
          <div className="py-4 flex flex-col items-start gap-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">Couldn’t load the labor budget — the request failed or timed out.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setData(null)
                load()
              }}
            >
              Retry
            </Button>
          </div>
        ) : !res.hasForecast || !res.budget ? (
          <EmptyState canManage={res.canManage} onSet={() => setEditing(true)} />
        ) : (
          <BudgetBody res={res} onEdit={() => setEditing(true)} />
        )}
      </CardContent>

      {editing && res && (
        <ForecastDialog
          storeId={storeId}
          weekStart={res.weekStart}
          currentTotal={res.forecast?.total ?? null}
          isManual={res.source === "MANUAL"}
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

function EmptyState({ canManage, onSet }: { canManage: boolean; onSet: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-start justify-center gap-2 py-2">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No sales forecast for this week yet. Set up sales goals in Forecasting{canManage ? ", or enter a manual total" : ""} to see the schedulable-hours budget.
      </p>
      {canManage && (
        <Button size="sm" onClick={onSet}>
          Enter a manual total
        </Button>
      )}
    </div>
  )
}

function BudgetBody({ res, onEdit }: { res: BudgetResponse; onEdit: () => void }) {
  const budget = res.budget!
  const projected = budget.projectedLaborPctAtForecast
  const z = projected == null ? zone(0, res.target) : zone(projected, res.target)
  const fillPct = projected == null ? 0 : Math.min(100, (projected / res.target) * 100)
  const buffer = projected == null ? null : res.target - projected
  // Only call it "adjusted" when a real weather adjustment exists — not when the
  // daily-split rounding nudges the number.
  const adjusted = res.weekAdjustments.length > 0
  const shownHours = adjusted ? res.adjustedTotalSchedulableHours ?? budget.totalSchedulableHours : budget.totalSchedulableHours

  return (
    <>
      <p className="text-[34px] leading-tight font-extrabold text-[var(--color-foreground)]">
        {shownHours.toFixed(1)}
        <span className="text-lg font-bold text-[var(--color-muted-foreground)]"> hrs</span>
      </p>
      <p className="text-[12.5px] text-[var(--color-muted-foreground)] mb-2">
        schedulable this week
        {adjusted && <span className="text-[var(--color-primary)]"> · adjusted from {budget.totalSchedulableHours.toFixed(1)}</span>}
      </p>

      {/* Source of the forecast: auto vs manual override */}
      <div className="flex items-center gap-1.5 mb-3">
        {res.source === "MANUAL" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[var(--color-muted)] text-[var(--color-foreground)]">
            <Pencil className="h-3 w-3" /> Manual · {usd(res.forecast!.total)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <Sparkles className="h-3 w-3" /> Auto from Forecasting · {usd(res.forecast!.total)}
          </span>
        )}
        {res.canManage && (
          <button className="text-[11px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]" onClick={onEdit}>
            {res.source === "MANUAL" ? "Edit" : "Override"}
          </button>
        )}
      </div>

      {budget.floorExceedsBudget && (
        <div className="flex items-start gap-1.5 mb-3 text-[12px] font-medium text-[#b42318] bg-[#fdecea] rounded-md px-2 py-1.5">
          <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Salaried pay alone exceeds this week’s budget — no hours left for hourly staff. Raise the forecast or the target %.</span>
        </div>
      )}

      <div className="mb-1 flex items-baseline justify-between">
        <span className={`text-[13px] font-bold ${z.text}`}>
          {projected == null ? "—" : `${projected.toFixed(1)}%`} projected labor
        </span>
        <span className="text-[11.5px] text-[var(--color-muted-foreground)]">target {res.target.toFixed(1)}%</span>
      </div>
      <div className="h-[11px] rounded-full bg-[var(--color-muted)] overflow-hidden mb-2">
        <div className="h-full rounded-full" style={{ width: `${fillPct.toFixed(1)}%`, backgroundColor: z.bar }} />
      </div>
      {buffer != null && (
        <p className="text-[12px] text-[var(--color-muted-foreground)] mb-2">
          {buffer >= 0 ? `${buffer.toFixed(1)} pts under target` : `${Math.abs(buffer).toFixed(1)} pts over target`}
        </p>
      )}

      {res.weekAdjustments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {res.weekAdjustments.map((a) => (
            <span
              key={a.date}
              className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[var(--color-warning)]/15 text-[#a36a00]"
              title={a.reason ?? undefined}
            >
              {dayShort(a.date)} {a.adjustmentPct > 0 ? "+" : ""}{a.adjustmentPct}%{a.reason ? ` · ${a.reason}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--color-border)] pt-3 grid grid-cols-2 gap-y-1 gap-x-3 text-[12.5px] mt-auto">
        <span className="text-[var(--color-muted-foreground)]">Conservative tier</span>
        <span className="text-right font-semibold text-[var(--color-foreground)]">{usd(budget.conservativeSales)}</span>
        <span className="text-[var(--color-muted-foreground)]">Weekly budget</span>
        <span className="text-right font-semibold text-[var(--color-foreground)]">{usd(budget.totalLaborBudget)}</span>
        <span className="text-[var(--color-muted-foreground)]">Salaried (fixed)</span>
        <span className="text-right text-[var(--color-foreground)]">{usd(budget.salariedCost)} · {budget.salariedHours} hrs</span>
        <span className="text-[var(--color-muted-foreground)]">Hourly pool</span>
        <span className="text-right text-[var(--color-foreground)]">{usd(budget.hourlyDollars)} · {budget.hourlyHours.toFixed(1)} hrs</span>
      </div>

      <Link href="/labor" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline mt-3">
        <CalendarRange className="h-3.5 w-3.5" /> Open Weekly Plan
      </Link>
    </>
  )
}

function ForecastDialog({
  storeId,
  weekStart,
  currentTotal,
  isManual,
  onClose,
  onSaved,
}: {
  storeId: string
  weekStart: string
  currentTotal: number | null
  isManual: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [total, setTotal] = useState(currentTotal != null ? String(currentTotal) : "")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(total)
    if (!(n >= 0) || total.trim() === "") {
      setErr("Enter a total projected sales figure.")
      return
    }
    setSaving(true)
    setErr(null)
    const res = await fetch("/api/labor/forecast", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, weekStart, total: n }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) return setErr("Couldn’t save — try again.")
    onSaved()
  }

  async function revert() {
    setSaving(true)
    const res = await fetch(`/api/labor/forecast?storeId=${storeId}&weekStart=${weekStart}`, { method: "DELETE" }).catch(() => null)
    setSaving(false)
    if (res?.ok) onSaved()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projected sales · {weekLabel(weekStart)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            By default the budget uses your Forecasting total for the week. Enter a manual total to override it just for labor.
          </p>
          <div>
            <Label htmlFor="f-total">Total projected sales ($)</Label>
            <Input id="f-total" type="number" min="0" step="1" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus />
          </div>
          {err && <p className="text-sm text-[var(--color-destructive)]">{err}</p>}
        </div>
        <DialogFooter>
          {isManual && (
            <Button variant="outline" onClick={revert} disabled={saving} className="mr-auto">
              Revert to auto
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save override"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
