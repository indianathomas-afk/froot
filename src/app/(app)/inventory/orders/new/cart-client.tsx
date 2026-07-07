"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { AlertTriangle, Sparkles, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

type GuideVendor = { vendorId: string; vendorName: string; casePrice: number | null; vendorSku: string | null }

type GuideRow = {
  ingredientId: string
  name: string
  categoryName: string | null
  reportingUnit: string
  purchaseUnitLabel: string
  packDescription: string | null
  unitsPerPurchase: number
  purchaseCost: number
  latestCountQty: number | null
  expectedQty: number | null
  weeklyUsage: number | null
  parLevel: number | null
  reorderPoint: number | null
  vendors: GuideVendor[]
}

type Guide = {
  storeId: string
  baseCount: { id: string; name: string | null; finalizedAt: string } | null
  daysSinceCount: number
  isStale: boolean
  salesDataComplete: boolean
  usageBasis: "periods" | "sales" | "none"
  rows: GuideRow[]
  allVendors: { id: string; name: string; minOrderCases: number | null; minOrderDollars: number | null }[]
}

// qty is entered as text in either purchase units ("case") or reporting units.
type CartLine = { qty: string; mode: "case" | "unit"; vendorId: string | null }

type GroupBy = "vendor" | "all" | "category"
type InvBasis = "latest" | "expected"

const NO_VENDOR = "__none__"

function fmtQty(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function CartClient({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [result, setResult] = useState<{ storeId: string; guide: Guide | null } | null>(null)
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [groupBy, setGroupBy] = useState<GroupBy>("vendor")
  const [invBasis, setInvBasis] = useState<InvBasis>("expected")
  const [search, setSearch] = useState("")
  const [smartOpen, setSmartOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const loading = Boolean(storeId) && result?.storeId !== storeId
  const guide = loading ? null : result?.guide ?? null

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    fetch(`/api/inventory/order-guide?storeId=${storeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setResult({ storeId, guide: json })
      })
      .catch(() => {
        if (!cancelled) setResult({ storeId, guide: null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  const rowById = useMemo(() => new Map((guide?.rows ?? []).map((r) => [r.ingredientId, r])), [guide])

  function onHand(row: GuideRow): number | null {
    return invBasis === "latest" ? row.latestCountQty : row.expectedQty
  }

  function cartVendorId(row: GuideRow): string | null {
    const line = cart[row.ingredientId]
    if (line?.vendorId) return line.vendorId
    return row.vendors[0]?.vendorId ?? null
  }

  function vendorPrice(row: GuideRow, vendorId: string | null): number {
    const v = row.vendors.find((x) => x.vendorId === vendorId)
    return v?.casePrice ?? row.purchaseCost
  }

  // Purchase units (cases) represented by a cart line.
  function qtyUnits(row: GuideRow, line: CartLine): number {
    const n = Number(line.qty)
    if (!Number.isFinite(n) || n <= 0) return 0
    return line.mode === "case" ? n : row.unitsPerPurchase > 0 ? n / row.unitsPerPurchase : 0
  }

  function setLine(ingredientId: string, patch: Partial<CartLine>) {
    setCart((prev) => {
      const existing = prev[ingredientId] ?? { qty: "", mode: "case" as const, vendorId: null }
      return { ...prev, [ingredientId]: { ...existing, ...patch } }
    })
  }

  const cartRows = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, line]) => ({ row: rowById.get(id), line }))
        .filter((x): x is { row: GuideRow; line: CartLine } => Boolean(x.row) && qtyUnits(x.row!, x.line) > 0),
    [cart, rowById]
  )

  const vendorTotals = useMemo(() => {
    const totals = new Map<string, { vendorName: string; items: number; cases: number; total: number }>()
    for (const { row, line } of cartRows) {
      const vid = cartVendorId(row) ?? NO_VENDOR
      const name =
        vid === NO_VENDOR ? "No vendor" : row.vendors.find((v) => v.vendorId === vid)?.vendorName ?? "Vendor"
      const t = totals.get(vid) ?? { vendorName: name, items: 0, cases: 0, total: 0 }
      const units = qtyUnits(row, line)
      t.items += 1
      t.cases += units
      t.total += units * vendorPrice(row, vid === NO_VENDOR ? null : vid)
      totals.set(vid, t)
    }
    return totals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartRows])

  // BevSpot-style "minimum not met" — warn, never block.
  function minimumWarning(vendorId: string, t: { cases: number; total: number }): string | null {
    const v = guide?.allVendors.find((x) => x.id === vendorId)
    if (!v) return null
    const problems: string[] = []
    if (v.minOrderCases != null && t.cases < v.minOrderCases) {
      problems.push(`${fmtQty(t.cases)} of ${fmtQty(v.minOrderCases)} case minimum`)
    }
    if (v.minOrderDollars != null && t.total < v.minOrderDollars) {
      problems.push(`${fmtMoney(t.total)} of ${fmtMoney(v.minOrderDollars)} minimum`)
    }
    return problems.length > 0 ? `Minimum not met — ${problems.join(", ")}` : null
  }

  const cartTotal = [...vendorTotals.values()].reduce((s, t) => s + t.total, 0)
  const unassignedCount = vendorTotals.get(NO_VENDOR)?.items ?? 0

  const filteredRows = useMemo(() => {
    const rows = guide?.rows ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.categoryName ?? "").toLowerCase().includes(q))
  }, [guide, search])

  const groups = useMemo(() => {
    if (groupBy === "all") return [{ key: "all", label: null as string | null, rows: filteredRows }]
    const map = new Map<string, { label: string; rows: GuideRow[] }>()
    for (const row of filteredRows) {
      let key: string, label: string
      if (groupBy === "vendor") {
        const vid = cartVendorId(row)
        key = vid ?? NO_VENDOR
        label = vid ? row.vendors.find((v) => v.vendorId === vid)?.vendorName ?? "Vendor" : "No vendor"
      } else {
        label = row.categoryName ?? "No Category"
        key = label
      }
      const g = map.get(key) ?? { label, rows: [] }
      g.rows.push(row)
      map.set(key, g)
    }
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === NO_VENDOR) return 1
        if (b[0] === NO_VENDOR) return -1
        return a[1].label.localeCompare(b[1].label)
      })
      .map(([key, g]) => ({ key, label: g.label, rows: g.rows }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, groupBy, cart])

  async function assignVendor(row: GuideRow, vendorId: string) {
    const res = await fetch("/api/inventory/ingredients/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [row.ingredientId], vendorId }),
    })
    if (!res.ok) return
    const vendor = guide?.allVendors.find((v) => v.id === vendorId)
    setResult((prev) => {
      if (!prev?.guide) return prev
      return {
        ...prev,
        guide: {
          ...prev.guide,
          rows: prev.guide.rows.map((r) =>
            r.ingredientId === row.ingredientId && vendor
              ? { ...r, vendors: [...r.vendors, { vendorId, vendorName: vendor.name, casePrice: null, vendorSku: null }] }
              : r
          ),
        },
      }
    })
    setLine(row.ingredientId, { vendorId })
  }

  function smartFill(mode: "par" | "usage", weeks: number) {
    if (!guide) return
    setCart((prev) => {
      const next = { ...prev }
      for (const row of guide.rows) {
        const target = mode === "par" ? row.parLevel : row.weeklyUsage !== null ? row.weeklyUsage * weeks : null
        if (target === null || target <= 0) continue
        const have = onHand(row) ?? 0
        const deficit = Math.max(0, target - have)
        const cases = row.unitsPerPurchase > 0 ? Math.ceil(deficit / row.unitsPerPurchase - 1e-9) : 0
        const existing = next[row.ingredientId] ?? { qty: "", mode: "case" as const, vendorId: null }
        next[row.ingredientId] = { ...existing, qty: cases > 0 ? String(cases) : "", mode: "case" }
      }
      return next
    })
    setSmartOpen(false)
  }

  async function createOrders() {
    if (!guide) return
    setCreating(true)
    setCreateError(null)
    try {
      const lines = cartRows
        .map(({ row, line }) => {
          const vendorId = cartVendorId(row)
          if (!vendorId) return null
          return {
            ingredientId: row.ingredientId,
            vendorId,
            quantityOrdered: qtyUnits(row, line),
            unitCost: vendorPrice(row, vendorId),
          }
        })
        .filter((l): l is NonNullable<typeof l> => l !== null)
      if (lines.length === 0) {
        setCreateError("Nothing orderable in the cart — assign vendors first.")
        return
      }
      const res = await fetch("/api/inventory/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, lines }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setCreateError(data.error ?? "Failed to create orders")
        return
      }
      router.push("/inventory/purchase-orders")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="pb-28">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Order Cart</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Build orders across all vendors at once — one draft PO per vendor is created from the cart.
          </p>
        </div>
        <Button variant="outline" onClick={() => setSmartOpen(true)} disabled={!guide}>
          <Sparkles className="h-4 w-4" />
          Smart Cart
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Select store" /></SelectTrigger>
          <SelectContent>
            {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="vendor">By Vendor</SelectItem>
            <SelectItem value="all">All Items</SelectItem>
            <SelectItem value="category">By Category</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center rounded-md border border-[var(--color-border)] overflow-hidden text-sm">
          {(["latest", "expected"] as InvBasis[]).map((b) => (
            <button
              key={b}
              onClick={() => setInvBasis(b)}
              className={
                "px-3 py-1.5 transition-colors " +
                (invBasis === b
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]")
              }
            >
              {b === "latest" ? "Latest Count" : "Expected"}
            </button>
          ))}
        </div>
        <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
      </div>

      {guide && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-xs text-[var(--color-muted-foreground)]">
          {guide.baseCount ? (
            <span>
              Inventory as of {format(new Date(guide.baseCount.finalizedAt), "M/d/yyyy")} ({guide.daysSinceCount}d ago)
              {invBasis === "expected" ? ", rolled forward" : ""}
            </span>
          ) : (
            <span className="text-[var(--color-warning-text)]">
              No finalized count yet — inventory shows as “—” and Smart Cart treats on-hand as 0.
            </span>
          )}
          {guide.isStale && (
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3 mr-1" />
              count is stale
            </Badge>
          )}
          {guide.baseCount && !guide.salesDataComplete && invBasis === "expected" && (
            <Badge variant="secondary">sales data incomplete — reduced confidence</Badge>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : !guide ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-sm text-[var(--color-muted-foreground)]">
          Couldn&apos;t load the order guide. Try again.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.key}>
              {group.label !== null && (
                <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-2">
                  {group.label}{" "}
                  <span className="text-[var(--color-muted-foreground)] font-normal">({group.rows.length})</span>
                  {group.key === NO_VENDOR && (
                    <span className="ml-2 text-xs font-normal text-[var(--color-warning-text)]">
                      can&apos;t be ordered until a vendor is assigned
                    </span>
                  )}
                </h2>
              )}
              <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        {["Item", "On Hand", "Usage / wk", "Par", "Case Price", "Order Qty", "Total"].map((h, i) => (
                          <th
                            key={h}
                            className={`text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3 ${i === 0 ? "text-left" : i >= 5 ? "text-left" : "text-right"}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => {
                        const line = cart[row.ingredientId] ?? { qty: "", mode: "case" as const, vendorId: null }
                        const vid = cartVendorId(row)
                        const units = qtyUnits(row, line)
                        const have = onHand(row)
                        const belowTrigger =
                          have !== null &&
                          ((row.reorderPoint ?? row.parLevel) !== null && have < (row.reorderPoint ?? row.parLevel)!)
                        return (
                          <tr
                            key={row.ingredientId}
                            className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-[var(--color-foreground)]">{row.name}</p>
                              <p className="text-xs text-[var(--color-muted-foreground)]">
                                {row.purchaseUnitLabel}
                                {row.packDescription ? ` (${row.packDescription})` : ""} · {fmtQty(row.unitsPerPurchase)}{" "}
                                {row.reportingUnit}
                              </p>
                              {!vid && guide.allVendors.length > 0 && (
                                <div className="mt-1">
                                  <Select value="" onValueChange={(v) => assignVendor(row, v)}>
                                    <SelectTrigger className="h-7 w-40 text-xs">
                                      <SelectValue placeholder="Assign vendor..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {guide.allVendors.map((v) => (
                                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </td>
                            <td
                              className={`px-4 py-3 text-sm text-right ${belowTrigger ? "font-medium text-[var(--color-warning-text)]" : "text-[var(--color-foreground)]"}`}
                            >
                              {have !== null ? `${fmtQty(have)} ${row.reportingUnit}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-[var(--color-muted-foreground)]">
                              {row.weeklyUsage !== null ? fmtQty(row.weeklyUsage) : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-[var(--color-muted-foreground)]">
                              {row.parLevel !== null ? fmtQty(row.parLevel) : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-[var(--color-muted-foreground)]">
                              {fmtMoney(vendorPrice(row, vid))}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  min={0}
                                  value={line.qty}
                                  onChange={(e) => setLine(row.ingredientId, { qty: e.target.value })}
                                  className="h-8 w-20 text-sm"
                                />
                                <button
                                  onClick={() => {
                                    const n = Number(line.qty)
                                    const converted =
                                      line.qty.trim() === "" || !Number.isFinite(n)
                                        ? line.qty
                                        : line.mode === "case"
                                          ? String(Math.round(n * row.unitsPerPurchase * 100) / 100)
                                          : String(Math.round((n / row.unitsPerPurchase) * 100) / 100)
                                    setLine(row.ingredientId, {
                                      mode: line.mode === "case" ? "unit" : "case",
                                      qty: converted,
                                    })
                                  }}
                                  className="text-xs px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors whitespace-nowrap"
                                  title="Toggle between purchase unit and reporting unit"
                                >
                                  {line.mode === "case" ? row.purchaseUnitLabel : row.reportingUnit}
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-left text-[var(--color-foreground)] whitespace-nowrap">
                              {units > 0 ? fmtMoney(units * vendorPrice(row, vid)) : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sticky cart summary */}
      {cartRows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
          <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {[...vendorTotals.entries()].map(([vid, t]) => (
                <span key={vid} className={vid === NO_VENDOR ? "text-[var(--color-warning-text)]" : "text-[var(--color-foreground)]"}>
                  <span className="font-medium">{t.vendorName}</span>: {t.items} item{t.items === 1 ? "" : "s"} ·{" "}
                  {fmtMoney(t.total)}
                </span>
              ))}
            </div>
            <span className="text-sm font-semibold text-[var(--color-foreground)]">{fmtMoney(cartTotal)}</span>
            <Button variant="outline" size="sm" onClick={() => setCart({})}>
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
            <Button size="sm" onClick={() => setReviewOpen(true)}>
              Review &amp; Create Orders
            </Button>
          </div>
        </div>
      )}

      {/* Smart Cart dialog */}
      <SmartCartDialog
        open={smartOpen}
        invBasis={invBasis}
        usageBasis={guide?.usageBasis ?? "none"}
        onClose={() => setSmartOpen(false)}
        onFill={smartFill}
      />

      {/* Review dialog */}
      <Dialog open={reviewOpen} onOpenChange={(o) => !o && setReviewOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create draft orders</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              One draft purchase order per vendor. You can adjust, submit, and receive them from Purchase Orders.
            </p>
            <div className="space-y-2">
              {[...vendorTotals.entries()]
                .filter(([vid]) => vid !== NO_VENDOR)
                .map(([vid, t]) => {
                  const warning = minimumWarning(vid, t)
                  return (
                    <div key={vid} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[var(--color-foreground)]">{t.vendorName}</span>
                        <span className="text-[var(--color-muted-foreground)]">
                          {t.items} item{t.items === 1 ? "" : "s"} · {fmtMoney(t.total)}
                        </span>
                      </div>
                      {warning && (
                        <p className="flex items-center gap-1 mt-1 text-xs text-[var(--color-warning-text)]">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {warning}
                        </p>
                      )}
                    </div>
                  )
                })}
            </div>
            {unassignedCount > 0 && (
              <p className="text-xs text-[var(--color-warning-text)] bg-[var(--color-warning-text)]/10 rounded-md px-3 py-2">
                {unassignedCount} item{unassignedCount === 1 ? "" : "s"} without a vendor will be left out — assign a
                vendor to include them.
              </p>
            )}
            {createError && <p className="text-xs text-[var(--color-destructive)]">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Keep editing</Button>
            <Button onClick={createOrders} disabled={creating || vendorTotals.size - (unassignedCount > 0 ? 1 : 0) === 0}>
              {creating ? "Creating..." : "Create Draft Orders"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {cartRows.length === 0 && (
        <p className="mt-6 text-xs text-[var(--color-muted-foreground)]">
          Tip: set pars on{" "}
          <Link href="/inventory/ingredients" className="text-[var(--color-primary)] hover:underline">
            Ingredients
          </Link>{" "}
          and Smart Cart fills the whole order in one click. Unsure of pars? Fill to weekly usage for a few weeks to
          discover them.
        </p>
      )}
    </div>
  )
}

function SmartCartDialog({
  open,
  invBasis,
  usageBasis,
  onClose,
  onFill,
}: {
  open: boolean
  invBasis: InvBasis
  usageBasis: "periods" | "sales" | "none"
  onClose: () => void
  onFill: (mode: "par" | "usage", weeks: number) => void
}) {
  const [mode, setMode] = useState<"par" | "usage">("par")
  const [weeks, setWeeks] = useState("2")

  const weeksNum = Number(weeks)
  const canFill = mode === "par" || (Number.isFinite(weeksNum) && weeksNum > 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Smart Cart</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Auto-fills order quantities from {invBasis === "latest" ? "the latest finalized count" : "expected inventory"},
            rounded up to whole purchase units. Review and adjust before creating orders.
          </p>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "par" | "usage")} className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <RadioGroupItem value="par" className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-[var(--color-foreground)] block">Fill to par</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Order the difference between par and on-hand for every item with a par at this store.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <RadioGroupItem value="usage" className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-[var(--color-foreground)] block">Fill to weekly usage</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Order up to N weeks of average usage — useful while discovering pars.
                  {usageBasis === "none" && " (No usage data yet for this store.)"}
                </span>
              </span>
            </label>
          </RadioGroup>
          {mode === "usage" && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">Weeks of usage</Label>
              <Input type="number" min={1} step={0.5} value={weeks} onChange={(e) => setWeeks(e.target.value)} className="h-9 w-24" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onFill(mode, mode === "usage" ? weeksNum : 0)} disabled={!canFill}>
            Fill Cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
