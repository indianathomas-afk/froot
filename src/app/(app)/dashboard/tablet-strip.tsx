"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { canRefresh, TABLET_REFRESH_MS } from "@/lib/tablet-messages"
import { formatLaborPct, judgeLaborPct, laborVerdictClass, type LaborBlock } from "@/lib/labor-judgment"
import { laborNoValueLabel } from "./labor-pct"
import { fetchCard } from "./card-fetch"

// TAB-3 — the Tablet stat strip, below the Tasks and Messages columns (ruling
// 4; moved here from TAB-2 by its ruling 1). Optional tiles, ADMIN-ordered and
// all off by default: Sales, Monthly Goal, Labor %.
//
// ONE EXISTING ENDPOINT, NO NEW ONE: GET /api/dashboard/summary?storeId= —
// the payload behind the desktop Monthly Goal card. Each tile shows the figure
// the desktop shows (audit § 2):
//   sales         sales.today.total = SalesPeriodCache.netSales for today, the
//                 Sales Performance card's "Today so far", with its ▲/▼ vs the
//                 same weekday last year (DeltaPill's formula).
//   monthly-goal  goal.monthToDate / goal.goalAmount, capped at 100% — the
//                 Monthly Goal card's "% of goal".
//   labor-pct     `labor`, MONTH-TO-DATE (audit F4) — the Monthly Goal card's
//                 "<Month> labor %" line, judged the same way.
//
// PERMISSIONS ARE THE PAYLOAD'S (ruling 5). The route 403s a store this login
// isn't assigned to. `labor` is ABSENT unless the overlay is on and the viewer
// holds labor.actuals.view (AL-2), so the Labor tile has nothing to render for
// anyone who couldn't see labor % on desktop. Sales has no capability gate on
// desktop either; it hides only when the store has no sales (no Square link /
// Inventory module — audit F8). A goal that isn't set reads "No goal set"
// (F9), as the desktop card does. If no enabled tile survives, the strip
// renders nothing at all.
//
// LIVE: the Messages column's timer (TAB-2 ruling 8) — every
// TABLET_REFRESH_MS while visible, at once on becoming visible again, never
// while hidden. A failed refresh keeps the numbers on screen (BUG-6's rule:
// never flip real numbers into an error state).

type StripSummary = {
  salesAvailable: boolean
  sales: { today: { total: number }; lastYear: { total: number } | null } | null
  goal: { month: string; goalAmount: number | null; monthToDate: number | null }
  labor?: LaborBlock
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

export function StatStrip({ storeId, tiles }: { storeId: string; tiles: string[] }) {
  const [res, setRes] = useState<{ storeId: string; data: StripSummary } | null>(null)

  const load = useCallback((): Promise<void> => {
    return fetchCard<StripSummary>("tablet strip", `/api/dashboard/summary?storeId=${storeId}`).then((data) => {
      if (data) setRes({ storeId, data })
    })
  }, [storeId])

  const refreshing = useRef(false)
  const lastRefresh = useRef(0)
  useEffect(() => {
    void load()
    const refresh = () => {
      if (!canRefresh(document.visibilityState, false) || refreshing.current) return
      // visibilitychange and focus usually fire together on return; one read.
      if (Date.now() - lastRefresh.current < 1_000) return
      refreshing.current = true
      lastRefresh.current = Date.now()
      void load().finally(() => {
        refreshing.current = false
      })
    }
    const onBack = () => {
      if (document.visibilityState === "visible") refresh()
    }
    const id = window.setInterval(refresh, TABLET_REFRESH_MS)
    document.addEventListener("visibilitychange", onBack)
    window.addEventListener("focus", onBack)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onBack)
      window.removeEventListener("focus", onBack)
    }
  }, [load])

  const data = res && res.storeId === storeId ? res.data : null

  // NO SKELETON, deliberately (Gary, 2026-11-10: "When no stat-strip tile is
  // visible to the viewer, render no strip container (no gap)"). Which tiles
  // this viewer may see is only known from the payload, so a placeholder
  // would show a strip to someone who then gets none. Before the first answer,
  // and if it never comes, there is no strip at all.
  if (!data) return null

  const rendered = tiles.map((t) => tile(t, data)).filter((x): x is NonNullable<typeof x> => x !== null)
  if (rendered.length === 0) return null

  return (
    <div className="flex gap-3">
      {rendered.map((r) => (
        <div
          key={r.key}
          className="flex min-h-[72px] flex-1 items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-3"
        >
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{r.label}</p>
          <div className="flex items-baseline gap-2 text-right">
            <span className={cn("text-2xl font-extrabold text-[var(--color-foreground)]", r.valueClass)}>{r.value}</span>
            {r.aside}
          </div>
        </div>
      ))}
    </div>
  )
}

type Tile = { key: string; label: string; value: string; valueClass?: string; aside?: React.ReactNode }

function tile(key: string, s: StripSummary): Tile | null {
  switch (key) {
    case "sales": {
      if (!s.salesAvailable || !s.sales) return null
      const today = s.sales.today.total
      const ly = s.sales.lastYear?.total ?? null
      // DeltaPill (sales-performance-card.tsx): hidden without a positive baseline.
      const delta = ly && ly > 0 ? ((today - ly) / ly) * 100 : null
      return {
        key,
        label: "Sales today",
        value: usd(today),
        aside:
          delta === null ? undefined : (
            <span
              className={cn(
                "text-sm font-bold",
                delta >= 0 ? "text-[var(--color-success-text,#1d7c2e)]" : "text-[var(--color-warning-text,#a36a00)]"
              )}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </span>
          ),
      }
    }
    case "monthly-goal": {
      const month = new Date(`${s.goal.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
      if (s.goal.goalAmount === null) {
        return { key, label: `${month} goal`, value: "No goal set", valueClass: "text-lg font-semibold text-[var(--color-muted-foreground)]" }
      }
      const pct = Math.min(1, (s.goal.monthToDate ?? 0) / s.goal.goalAmount)
      return { key, label: `${month} goal`, value: `${(pct * 100).toFixed(0)}%` }
    }
    case "labor-pct": {
      // Absent = a gate is off for this viewer: no tile, not an empty one.
      if (!s.labor) return null
      const block = s.labor
      const verdict = judgeLaborPct(block.laborPct, block.target, block.health)
      const note = laborNoValueLabel(block)
      // Month-named, as the desktop's "<Month> labor %" line is, so a
      // month-to-date number never reads as today's (audit F4).
      const month = new Date(`${s.goal.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
      return {
        key,
        label: `${month} labor`,
        value: formatLaborPct(block.laborPct),
        valueClass: laborVerdictClass(verdict),
        aside: (
          <span className="whitespace-nowrap text-sm text-[var(--color-muted-foreground)]">
            {note || `target ${block.target}%`}
          </span>
        ),
      }
    }
    default:
      return null
  }
}
