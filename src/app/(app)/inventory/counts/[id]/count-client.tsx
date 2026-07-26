"use client"

import { useCallback, useEffect, useState } from "react"
import { DraftCounting } from "./draft-counting"
import { SummaryView } from "./summary-view"

export type CountLine = {
  id: string
  storageAreaId: string | null
  ingredientId: string
  ingredientName: string
  reportingUnit: string
  quantityCounted: number | null
  costPerReportingUnit: number
  lineValue: number | null
  sortOrder: number
  countedAt: string | null
  unitsPerPurchase: number
  purchaseUnitLabel: string
  tareWeightOz: number | null
  fullWeightOz: number | null
  currentCostPerReportingUnit: number
}

export type CountArea = {
  id: string
  name: string
  sortOrder: number
  lines: CountLine[]
}

export type ActiveIngredient = {
  id: string
  name: string
  categoryName: string | null
  reportingUnit: string
  costPerReportingUnit: number
}

export type CountDetail = {
  id: string
  storeId: string
  storeName: string
  name: string | null
  notes: string | null
  status: string
  isPartial: boolean
  startedAt: string
  finalizedAt: string | null
  sittingInventoryVal: number | null
  countedByNames: string[]
  areas: CountArea[]
  activeIngredients: ActiveIngredient[]
}

export function CountClient({
  countId,
  canManage,
  canViewSummary,
}: {
  countId: string
  canManage: boolean
  // PERM-2 §3 #5: inventory.analytics.view, resolved server-side in page.tsx.
  canViewSummary: boolean
}) {
  const [detail, setDetail] = useState<CountDetail | null>(null)
  const [error, setError] = useState("")

  const refresh = useCallback(() => {
    return fetch(`/api/inventory/counts/${countId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          setError(body?.error ?? "Could not load this count")
          return
        }
        setDetail(await res.json())
      })
      .catch(() => setError("Could not load this count"))
  }, [countId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) {
    return <p className="p-16 text-center text-sm text-[var(--color-destructive)]">{error}</p>
  }
  if (!detail) {
    return (
      <div className="space-y-4">
        <div className="h-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
        ))}
      </div>
    )
  }

  if (detail.status === "Finalized") {
    // The summary is the valuation/variance review — commercial data. Without
    // the capability, say so plainly rather than rendering a view whose only
    // fetch 403s.
    if (!canViewSummary) {
      return (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">This count is finalized</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">Ask a manager for the summary.</p>
        </div>
      )
    }
    return <SummaryView countId={countId} canManage={canManage} />
  }
  return <DraftCounting detail={detail} refresh={refresh} canManage={canManage} />
}
