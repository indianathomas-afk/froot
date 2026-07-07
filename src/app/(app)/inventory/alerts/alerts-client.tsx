"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

type Alert = {
  ingredientId: string
  ingredientName: string
  reportingUnit: string
  purchaseUnitLabel: string
  unitsPerPurchase: number
  expectedQty: number
  parLevel: number | null
  reorderPoint: number | null
  triggerLevel: number
  suggestedOrderUnits: number
  suggestedOrderQty: number
  primaryVendorId: string | null
  primaryVendorName: string | null
  isNegative: boolean
}

type StoreAlerts = {
  storeId: string
  storeName: string
  baseCount: { id: string; name: string | null; finalizedAt: string } | null
  daysSinceCount: number
  isStale: boolean
  salesDataComplete: boolean
  alerts: Alert[]
}

function fmtQty(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function AlertsClient({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeFilter, setStoreFilter] = useState("all")
  const [result, setResult] = useState<{ key: string; stores: StoreAlerts[] } | null>(null)

  const loading = result?.key !== storeFilter
  const data = loading ? null : result?.stores ?? null

  useEffect(() => {
    let cancelled = false
    const params = storeFilter === "all" ? "" : `?storeId=${storeFilter}`
    fetch(`/api/inventory/alerts${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setResult({ key: storeFilter, stores: json?.stores ?? [] })
      })
      .catch(() => {
        if (!cancelled) setResult({ key: storeFilter, stores: [] })
      })
    return () => {
      cancelled = true
    }
  }, [storeFilter])

  const totalAlerts = useMemo(() => (data ?? []).reduce((s, g) => s + g.alerts.length, 0), [data])

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Low-Stock Alerts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Ingredients whose expected on-hand has dropped below the reorder point (or par when no reorder point is
            set).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!loading && (
          <Badge variant={totalAlerts > 0 ? "warning" : "success"}>
            {totalAlerts} alert{totalAlerts === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          {(data ?? []).map((group) => (
            <div key={group.storeId}>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">{group.storeName}</h2>
                {group.baseCount && (
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    last count {format(new Date(group.baseCount.finalizedAt), "M/d/yyyy")} ({group.daysSinceCount}d ago)
                  </span>
                )}
                {group.isStale && (
                  <Badge variant="warning">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    data is stale — count recommended
                  </Badge>
                )}
                {group.baseCount && !group.salesDataComplete && (
                  <Badge variant="secondary">sales data incomplete — reduced confidence</Badge>
                )}
              </div>

              {!group.baseCount ? (
                <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  No finalized full count yet — alerts need a counted starting point.{" "}
                  <Link href="/inventory/counts" className="text-[var(--color-primary)] font-medium hover:underline">
                    Start a count
                  </Link>
                </div>
              ) : group.alerts.length === 0 ? (
                <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-[var(--color-success)]" />
                  Everything with a par or reorder point is above its threshold.{" "}
                  <Link
                    href="/inventory/ingredients"
                    className="text-[var(--color-primary)] font-medium hover:underline"
                  >
                    Set pars on Ingredients
                  </Link>
                </div>
              ) : (
                <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border)]">
                          {["Ingredient", "Expected", "Par / Reorder", "Suggested Order", "Primary Vendor"].map((h, i) => (
                            <th
                              key={h}
                              className={`text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3 ${i === 0 || i === 4 ? "text-left" : "text-right"}`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.alerts.map((a) => (
                          <tr
                            key={a.ingredientId}
                            className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium text-[var(--color-foreground)]">{a.ingredientName}</span>
                              {a.isNegative && <Badge variant="destructive" className="ml-2">Negative</Badge>}
                            </td>
                            <td
                              className={`px-4 py-3 text-sm text-right font-medium ${a.isNegative ? "text-[var(--color-destructive)]" : "text-[var(--color-foreground)]"}`}
                            >
                              {fmtQty(a.expectedQty)} {a.reportingUnit}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-[var(--color-muted-foreground)]">
                              {a.parLevel !== null ? fmtQty(a.parLevel) : "—"} /{" "}
                              {a.reorderPoint !== null ? fmtQty(a.reorderPoint) : "—"} {a.reportingUnit}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-[var(--color-foreground)]">
                              <span className="font-medium">
                                {a.suggestedOrderUnits} {a.purchaseUnitLabel}
                              </span>
                              <span className="block text-xs text-[var(--color-muted-foreground)]">
                                = {fmtQty(a.suggestedOrderQty)} {a.reportingUnit}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                              {a.primaryVendorName ?? (
                                <span className="text-[var(--color-warning-text)]">No vendor on file</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
