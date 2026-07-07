"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, ShoppingCart } from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type PurchaseOrder = {
  id: string
  poNumber: string
  status: string
  totalAmount: number
  expectedAt: string | null
  createdAt: string
  store: { id: string; name: string }
  vendor: { id: string; name: string }
  lines: { quantityOrdered: number; quantityReceived: number }[]
}

const STATUS_VARIANT: Record<string, "secondary" | "info" | "warning" | "success" | "destructive"> = {
  DRAFT: "secondary",
  SUBMITTED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "destructive",
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
}

export function PurchaseOrdersClient({
  stores,
  canCreate,
}: {
  stores: { id: string; name: string }[]
  canCreate: boolean
}) {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [storeFilter, setStoreFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  useEffect(() => {
    const params = new URLSearchParams()
    if (storeFilter !== "all") params.set("storeId", storeFilter)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (from) params.set("from", from)
    if (to) params.set("to", to)

    fetch(`/api/inventory/purchase-orders?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setPurchaseOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [storeFilter, statusFilter, from, to])

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Purchase Orders</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Order from vendors and track receiving.</p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Link href="/inventory/orders/new">
              <Button variant="outline">
                <ShoppingCart className="h-4 w-4" />
                Order Cart
              </Button>
            </Link>
            <Link href="/inventory/purchase-orders/new">
              <Button>
                <Plus className="h-4 w-4" />
                New PO
              </Button>
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)] text-sm">Loading...</div>
        ) : purchaseOrders.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No purchase orders match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["PO #", "Store", "Vendor", "Status", "Total", "Expected", "Created"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => {
                  const received = po.lines.reduce((s, l) => s + l.quantityReceived, 0)
                  const ordered = po.lines.reduce((s, l) => s + l.quantityOrdered, 0)
                  return (
                    <tr key={po.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                      <td className="px-6 py-4">
                        <Link href={`/inventory/purchase-orders/${po.id}`} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
                          {po.poNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--color-foreground)]">{po.store.name}</td>
                      <td className="px-6 py-4 text-sm text-[var(--color-foreground)]">{po.vendor.name}</td>
                      <td className="px-6 py-4">
                        <Badge variant={STATUS_VARIANT[po.status] ?? "secondary"}>{STATUS_LABEL[po.status] ?? po.status}</Badge>
                        {ordered > 0 && po.status !== "DRAFT" && po.status !== "CANCELLED" && (
                          <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">{received}/{ordered} received</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--color-foreground)]">${po.totalAmount.toFixed(2)}</td>
                      <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                        {po.expectedAt ? format(new Date(po.expectedAt), "M/d/yyyy") : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                        {format(new Date(po.createdAt), "M/d/yyyy")}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
