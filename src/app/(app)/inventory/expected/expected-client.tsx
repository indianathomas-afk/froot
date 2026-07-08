"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { AlertTriangle, ClipboardList } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

type Row = {
  ingredientId: string
  ingredientName: string
  reportingUnit: string
  purchaseUnitLabel: string
  unitsPerPurchase: number
  categoryName: string | null
  isPrepared: boolean
  countQty: number
  onLastCount: boolean
  receivedQty: number
  soldUsageQty: number
  adjustmentQty: number
  expectedQty: number
  costPerReportingUnit: number
  expectedValue: number
  isNegative: boolean
}

type ExpectedResult = {
  storeId: string
  baseCount: { id: string; name: string | null; finalizedAt: string } | null
  asOf: string
  daysSinceCount: number
  isStale: boolean
  salesDataComplete: boolean
  missingSalesDays: number
  unmappedSoldCount: number
  expansionProblems: { salesItemId: string; displayName: string }[]
  rows: Row[]
}

function fmtQty(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function ExpectedClient({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [result, setResult] = useState<{ storeId: string; data: ExpectedResult | null } | null>(null)
  const [search, setSearch] = useState("")
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  // Loading is derived, not set synchronously in the effect: the fetched
  // payload carries its storeId, so a stale result never renders for the
  // newly selected store.
  const loading = Boolean(storeId) && result?.storeId !== storeId
  const data = loading ? null : result?.data ?? null

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    fetch(`/api/inventory/expected?storeId=${storeId}`)
      .then(async (res) => ({ ok: res.ok, json: await res.json() }))
      .then(({ ok, json }) => {
        if (!cancelled) setResult({ storeId, data: ok ? json : null })
      })
      .catch(() => {
        if (!cancelled) setResult({ storeId, data: null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  const rows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter((r) => {
      if (q && !r.ingredientName.toLowerCase().includes(q) && !(r.categoryName ?? "").toLowerCase().includes(q)) {
        return false
      }
      if (flaggedOnly && !r.isNegative && r.onLastCount) return false
      return true
    })
  }, [data, search, flaggedOnly])

  const totalValue = useMemo(() => rows.reduce((s, r) => s + Math.max(0, r.expectedValue), 0), [rows])

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Expected Inventory</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            What should be on hand right now — your last finalized count, rolled forward through deliveries, sales, and
            adjustments.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search ingredients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Switch checked={flaggedOnly} onCheckedChange={setFlaggedOnly} />
          Flagged rows only
        </label>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : !data || !data.baseCount ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <ClipboardList className="h-8 w-8 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
          <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">No finalized full count yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
            Expected inventory starts from a finalized, full physical count. Finalize one to unlock this report.
          </p>
          <Link href="/inventory/counts" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
            Go to Counts →
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 text-sm text-[var(--color-muted-foreground)]">
            <span>
              As of last finalized count:{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {data.baseCount.name || format(new Date(data.baseCount.finalizedAt), "M/d/yyyy")}
              </span>{" "}
              ({format(new Date(data.baseCount.finalizedAt), "M/d/yyyy h:mm a")}, {data.daysSinceCount}d ago)
            </span>
            <span>
              Expected value:{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </span>
          </div>

          {(data.isStale || !data.salesDataComplete || data.unmappedSoldCount > 0 || data.expansionProblems.length > 0) && (
            <div className="mb-4 space-y-2">
              {data.isStale && (
                <div className="flex items-center gap-2 text-sm rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-[var(--color-foreground)]">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
                  Last full count is {data.daysSinceCount} days old — numbers drift as time passes. A fresh count is
                  recommended.
                </div>
              )}
              {!data.salesDataComplete && (
                <div className="flex items-center gap-2 text-sm rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-[var(--color-foreground)]">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
                  {data.missingSalesDays > 0
                    ? `Sales data is missing for ${data.missingSalesDays} day${data.missingSalesDays === 1 ? "" : "s"} since the count`
                    : "This store isn't linked to Square sales"}
                  {" "}— expected quantities reflect counts, deliveries, and adjustments only (reduced confidence).
                </div>
              )}
              {data.unmappedSoldCount > 0 && (
                <div className="flex items-center gap-2 text-sm rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-[var(--color-foreground)]">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
                  {data.unmappedSoldCount} sold item{data.unmappedSoldCount === 1 ? "" : "s"} have no recipe — their
                  depletion isn&apos;t reflected here.{" "}
                  <Link href="/inventory/recipes" className="font-medium text-[var(--color-primary)] hover:underline">
                    Map recipes
                  </Link>
                </div>
              )}
              {data.expansionProblems.length > 0 && (
                <div className="flex items-center gap-2 text-sm rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-[var(--color-foreground)]">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
                  {data.expansionProblems.length} recipe{data.expansionProblems.length === 1 ? "" : "s"} couldn&apos;t be
                  expanded ({data.expansionProblems.map((p) => p.displayName).slice(0, 3).join(", ")}
                  {data.expansionProblems.length > 3 ? "…" : ""}) — fix loops or unit mismatches.
                </div>
              )}
            </div>
          )}

          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
            {rows.length === 0 ? (
              <div className="p-16 text-center text-[var(--color-muted-foreground)] text-sm">
                No ingredients match your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      {["Ingredient", "Category", "Counted", "Received", "Sold (theo.)", "Adjustments", "Expected", "Value"].map(
                        (h, i) => (
                          <th
                            key={h}
                            className={`text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3 ${i < 2 ? "text-left" : "text-right"}`}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.ingredientId}
                        className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-[var(--color-foreground)]">{r.ingredientName}</span>
                          {r.isPrepared && <Badge variant="secondary" className="ml-2">Prep</Badge>}
                          {!r.onLastCount && (
                            <Badge variant="warning" className="ml-2">Not on last count</Badge>
                          )}
                          {r.isNegative && <Badge variant="destructive" className="ml-2">Negative</Badge>}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{r.categoryName ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-right text-[var(--color-foreground)]">
                          {fmtQty(r.countQty)} {r.reportingUnit}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-[var(--color-foreground)]">
                          {r.receivedQty !== 0 ? `+${fmtQty(r.receivedQty)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-[var(--color-foreground)]">
                          {r.soldUsageQty !== 0 ? `−${fmtQty(r.soldUsageQty)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-[var(--color-foreground)]">
                          {r.adjustmentQty !== 0 ? `${r.adjustmentQty > 0 ? "+" : "−"}${fmtQty(Math.abs(r.adjustmentQty))}` : "—"}
                        </td>
                        <td
                          className={`px-4 py-3 text-sm text-right font-medium ${r.isNegative ? "text-[var(--color-destructive)]" : "text-[var(--color-foreground)]"}`}
                        >
                          {fmtQty(r.expectedQty)} {r.reportingUnit}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-[var(--color-foreground)]">
                          ${r.expectedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
