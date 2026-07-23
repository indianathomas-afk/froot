"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchCard } from "./card-fetch"

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
  mtdGoal: number | null
  monthGoal: number | null
  pace: number | null
  projected: number | null
  pctToGoal: number | null
}

type Rollup = {
  month: string
  totals: {
    todayNet: number
    mtdActual: number
    mtdGoal: number | null
    monthGoal: number | null
    projected: number | null
    pctToGoal: number | null
  }
  stores: RollupRow[]
}

const usd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`)

type SortKey = "name" | "todayNet" | "mtdActual" | "pace" | "projected" | "pctToGoal"

export function RollupView() {
  const [data, setData] = useState<Rollup | null>(null)
  const [failed, setFailed] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("mtdActual")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const load = useCallback(() => {
    fetchCard<Rollup>("rollup", "/api/dashboard/rollup").then((d) => (d ? setData(d) : setFailed(true)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Manual retry only: back to the skeleton, then one refetch.
  const retry = () => {
    setFailed(false)
    setData(null)
    load()
  }

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.stores].sort((a, b) => {
      if (sortKey === "name") return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      const av = a[sortKey]
      const bv = b[sortKey]
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
      </div>

      {/* Store ranking */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[15px] font-bold text-[var(--color-foreground)]">Store Ranking</p>
            <Link href="/forecasting" className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]">
              Forecasting →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                  {header("name", "Store", "left")}
                  {header("todayNet", "Today")}
                  {header("mtdActual", "MTD")}
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
                    <td colSpan={7} className="py-6 text-center text-[var(--color-muted-foreground)]">
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
