"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleAlert, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// Labor Budget hero card (Dashboard, Phase 1A). Derives the current week's
// schedulable-hours budget from the org's LaborSettings + positions + the
// weekly forecast (GET /api/labor/budget — computed on read, nothing stored).
// ADMIN/MANAGER can set/edit the forecast inline; other roles see it read-only.

type LaborBudget = {
  salesBasis: number
  conservativeSales: number
  totalLaborBudget: number
  salariedCost: number
  salariedHours: number
  hourlyDollars: number
  blendedHourlyRate: number
  hourlyHours: number
  totalSchedulableHours: number
  projectedLaborPctAtForecast: number | null
  floorExceedsBudget: boolean
}

type BudgetResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  weekStart: string
  canManage: boolean
  target: number
  denominator: "IN_STORE" | "TOTAL_WITH_DELIVERY"
  hasForecast: boolean
  forecast: { projectedStoreSales: number; projectedDelivery: number; source: string } | null
  budget: LaborBudget | null
}

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

const hrs = (n: number) => `${n.toFixed(1)} hr${n === 1 ? "" : "s"}`

function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  return `Week of ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

// Buffer zones vs the target ceiling: comfortable → green, thin → amber,
// at/over → red (the last is rare for a conservative budget but possible when
// the salaried floor dominates).
function zone(projected: number, target: number): { bar: string; text: string } {
  if (projected > target) return { bar: "#e5484d", text: "text-[#b42318]" }
  if (projected > target - 1) return { bar: "var(--color-warning)", text: "text-[#a36a00]" }
  return { bar: "var(--color-success)", text: "text-[#1d7c2e]" }
}

export function LaborBudgetCard({ storeId }: { storeId: string }) {
  const [data, setData] = useState<{ storeId: string; res: BudgetResponse | null } | null>(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => {
    if (!storeId) return
    fetch(`/api/labor/budget?storeId=${storeId}`)
      .then((r): Promise<BudgetResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => setData({ storeId, res }))
      .catch(() => setData({ storeId, res: null }))
  }, [storeId])

  useEffect(() => {
    load()
  }, [load])

  const loading = !data || data.storeId !== storeId
  if (loading) return <Skeleton className="h-64 w-full" />
  const res = data.res

  // API failure (not the empty state — that returns 200 with hasForecast:false).
  if (!res) {
    return (
      <Card className="h-full">
        <CardContent className="pt-5 pb-4">
          <CardHeading />
          <p className="text-sm text-[var(--color-muted-foreground)] py-4">
            Couldn’t load the labor budget — try again in a moment.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { budget } = res

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <CardHeading />
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
            {weekLabel(res.weekStart)}
          </span>
        </div>

        {!res.hasForecast || !budget ? (
          <EmptyState canManage={res.canManage} onSet={() => setEditing(true)} />
        ) : (
          <BudgetBody res={res} budget={budget} onEdit={() => setEditing(true)} />
        )}
      </CardContent>

      {editing && (
        <ForecastDialog
          storeId={storeId}
          weekStart={res.weekStart}
          initial={res.forecast}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      )}
    </Card>
  )
}

function CardHeading() {
  return (
    <div className="flex items-center gap-1.5">
      <Clock className="h-4 w-4 text-[var(--color-primary)]" />
      <p className="text-[15px] font-bold text-[var(--color-foreground)]">Labor Budget</p>
    </div>
  )
}

function EmptyState({ canManage, onSet }: { canManage: boolean; onSet: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-start justify-center gap-2 py-2">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No sales forecast for this week yet. {canManage ? "Set one to see the schedulable-hours budget." : "Ask your manager to set projected sales."}
      </p>
      {canManage && (
        <Button size="sm" onClick={onSet}>
          Set projected sales
        </Button>
      )}
    </div>
  )
}

function BudgetBody({ res, budget, onEdit }: { res: BudgetResponse; budget: LaborBudget; onEdit: () => void }) {
  const projected = budget.projectedLaborPctAtForecast
  const z = projected == null ? zone(0, res.target) : zone(projected, res.target)
  const fillPct = projected == null ? 0 : Math.min(100, (projected / res.target) * 100)
  const buffer = projected == null ? null : res.target - projected

  return (
    <>
      <p className="text-[34px] leading-tight font-extrabold text-[var(--color-foreground)]">
        {budget.totalSchedulableHours.toFixed(1)}
        <span className="text-lg font-bold text-[var(--color-muted-foreground)]"> hrs</span>
      </p>
      <p className="text-[12.5px] text-[var(--color-muted-foreground)] mb-3">schedulable this week</p>

      {budget.floorExceedsBudget && (
        <div className="flex items-start gap-1.5 mb-3 text-[12px] font-medium text-[#b42318] bg-[#fdecea] rounded-md px-2 py-1.5">
          <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Salaried pay alone exceeds this week’s budget — no hours left for hourly staff. Raise the forecast or the target %.</span>
        </div>
      )}

      {/* Projected labor % vs the target ceiling (full bar = target). */}
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
        <p className="text-[12px] text-[var(--color-muted-foreground)] mb-3">
          {buffer >= 0 ? `${buffer.toFixed(1)} pts under target` : `${Math.abs(buffer).toFixed(1)} pts over target`}
        </p>
      )}

      <div className="border-t border-[var(--color-border)] pt-3 grid grid-cols-2 gap-y-1 gap-x-3 text-[12.5px]">
        <span className="text-[var(--color-muted-foreground)]">Conservative tier</span>
        <span className="text-right font-semibold text-[var(--color-foreground)]">{usd(budget.conservativeSales)}</span>
        <span className="text-[var(--color-muted-foreground)]">Weekly budget</span>
        <span className="text-right font-semibold text-[var(--color-foreground)]">{usd(budget.totalLaborBudget)}</span>
        <span className="text-[var(--color-muted-foreground)]">Salaried floor</span>
        <span className="text-right text-[var(--color-foreground)]">
          {usd(budget.salariedCost)} · {budget.salariedHours} hrs
        </span>
        <span className="text-[var(--color-muted-foreground)]">Hourly pool</span>
        <span className="text-right text-[var(--color-foreground)]">
          {usd(budget.hourlyDollars)} · {hrs(budget.hourlyHours)}
        </span>
      </div>

      <div className="flex items-center justify-between mt-auto pt-3">
        <span className="text-[11.5px] text-[var(--color-muted-foreground)]">
          Forecast {usd(res.forecast!.projectedStoreSales)} store
          {res.forecast!.projectedDelivery > 0 ? ` + ${usd(res.forecast!.projectedDelivery)} delivery` : ""}
        </span>
        {res.canManage && (
          <button className="text-xs font-medium text-[var(--color-primary)] hover:underline" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
    </>
  )
}

function ForecastDialog({
  storeId,
  weekStart,
  initial,
  onClose,
  onSaved,
}: {
  storeId: string
  weekStart: string
  initial: { projectedStoreSales: number; projectedDelivery: number } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [store, setStore] = useState(initial ? String(initial.projectedStoreSales) : "")
  const [delivery, setDelivery] = useState(initial ? String(initial.projectedDelivery) : "0")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const storeNum = Number(store)
    const deliveryNum = Number(delivery || 0)
    if (!(storeNum >= 0) || !(deliveryNum >= 0) || store.trim() === "") {
      setErr("Enter projected store sales (and delivery, or 0).")
      return
    }
    setSaving(true)
    setErr(null)
    const res = await fetch("/api/labor/forecast", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, weekStart, projectedStoreSales: storeNum, projectedDelivery: deliveryNum }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      setErr("Couldn’t save — try again.")
      return
    }
    onSaved()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projected sales · {weekLabel(weekStart)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label htmlFor="f-store">Projected store sales ($)</Label>
            <Input id="f-store" type="number" min="0" step="1" value={store} onChange={(e) => setStore(e.target.value)} autoFocus />
          </div>
          <div>
            <Label htmlFor="f-delivery">Projected delivery sales ($)</Label>
            <Input id="f-delivery" type="number" min="0" step="1" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Counted in the labor-% basis only when the denominator includes delivery.
            </p>
          </div>
          {err && <p className="text-sm text-[var(--color-destructive)]">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save forecast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
