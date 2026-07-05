"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type Line = {
  id: string
  ingredientName: string
  purchaseUnitLabel: string
  quantityOrdered: number
  quantityReceived: number
  unitCost: number
  lineTotal: number
  receivingNote: string | null
}

type PurchaseOrder = {
  id: string
  poNumber: string
  status: string
  invoiceNumber: string | null
  totalAmount: number
  expectedAt: string | null
  orderedAt: string | null
  createdAt: string
  store: { name: string }
  vendor: { name: string }
  lines: Line[]
}

const STATUS_STEPS = ["DRAFT", "SUBMITTED", "RECEIVED"]

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

export function PurchaseOrderDetailClient({ po, canManage }: { po: PurchaseOrder; canManage: boolean }) {
  const router = useRouter()
  const [receiving, setReceiving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receiveInputs, setReceiveInputs] = useState<Record<string, { qty: string; note: string }>>(
    Object.fromEntries(po.lines.map((l) => [l.id, { qty: String(l.quantityOrdered - l.quantityReceived), note: "" }]))
  )

  const canReceive = po.status === "SUBMITTED" || po.status === "PARTIALLY_RECEIVED"
  const canSubmit = canManage && po.status === "DRAFT"
  const canCancel = canManage && (po.status === "DRAFT" || po.status === "SUBMITTED")
  const stepIndex = STATUS_STEPS.indexOf(po.status === "PARTIALLY_RECEIVED" ? "SUBMITTED" : po.status)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/purchase-orders/${po.id}/submit`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) return setError(data.error ?? "Failed to submit")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/purchase-orders/${po.id}/cancel`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) return setError(data.error ?? "Failed to cancel")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleReceive() {
    setBusy(true)
    setError(null)
    try {
      const payload = po.lines
        .map((l) => ({
          lineId: l.id,
          quantityReceivedDelta: Number(receiveInputs[l.id]?.qty) || 0,
          receivingNote: receiveInputs[l.id]?.note || null,
        }))
        .filter((r) => r.quantityReceivedDelta > 0)

      if (payload.length === 0) {
        setError("Enter a received quantity for at least one item")
        return
      }

      const res = await fetch(`/api/inventory/purchase-orders/${po.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) return setError(data.error ?? "Failed to receive")
      setReceiving(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{po.poNumber}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{po.store.name} · {po.vendor.name}</p>
        </div>
        <Badge variant={STATUS_VARIANT[po.status] ?? "secondary"}>{STATUS_LABEL[po.status] ?? po.status}</Badge>
      </div>

      {/* Status timeline */}
      {po.status !== "CANCELLED" && (
        <div className="flex items-center gap-2 mb-8">
          {STATUS_STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-2 flex-1">
              <div
                className={`h-2 flex-1 rounded-full ${i <= stepIndex ? "bg-[var(--color-primary)]" : "bg-[var(--color-muted)]"}`}
              />
              {i < STATUS_STEPS.length - 1 && <span />}
            </div>
          ))}
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 mb-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-[var(--color-muted-foreground)]">Invoice #</p>
          <p className="text-[var(--color-foreground)]">{po.invoiceNumber ?? "—"}</p>
        </div>
        <div>
          <p className="text-[var(--color-muted-foreground)]">Expected</p>
          <p className="text-[var(--color-foreground)]">{po.expectedAt ? format(new Date(po.expectedAt), "M/d/yyyy") : "—"}</p>
        </div>
        <div>
          <p className="text-[var(--color-muted-foreground)]">Ordered</p>
          <p className="text-[var(--color-foreground)]">{po.orderedAt ? format(new Date(po.orderedAt), "M/d/yyyy") : "Not yet submitted"}</p>
        </div>
        <div>
          <p className="text-[var(--color-muted-foreground)]">Total</p>
          <p className="text-[var(--color-foreground)] font-medium">${po.totalAmount.toFixed(2)}</p>
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {["Item", "Ordered", "Received", "Unit Cost", "Line Total", ...(receiving ? ["Receive Now", "Note"] : [])].map((h) => (
                <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => {
              const remaining = line.quantityOrdered - line.quantityReceived
              return (
                <tr key={line.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-sm text-[var(--color-foreground)]">{line.ingredientName}</td>
                  <td className="px-4 py-2 text-sm text-[var(--color-muted-foreground)]">{line.quantityOrdered} {line.purchaseUnitLabel}</td>
                  <td className="px-4 py-2 text-sm text-[var(--color-muted-foreground)]">{line.quantityReceived} {line.purchaseUnitLabel}</td>
                  <td className="px-4 py-2 text-sm text-[var(--color-muted-foreground)]">${line.unitCost.toFixed(2)}</td>
                  <td className="px-4 py-2 text-sm text-[var(--color-foreground)]">${line.lineTotal.toFixed(2)}</td>
                  {receiving && (
                    <>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          className="h-8 w-20 text-sm"
                          value={receiveInputs[line.id]?.qty ?? ""}
                          disabled={remaining <= 0}
                          onChange={(e) =>
                            setReceiveInputs((prev) => ({ ...prev, [line.id]: { ...prev[line.id], qty: e.target.value } }))
                          }
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          className="h-8 w-32 text-sm"
                          placeholder="Discrepancy?"
                          value={receiveInputs[line.id]?.note ?? ""}
                          onChange={(e) =>
                            setReceiveInputs((prev) => ({ ...prev, [line.id]: { ...prev[line.id], note: e.target.value } }))
                          }
                        />
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-[var(--color-destructive)] mb-4">{error}</p>}

      <div className="flex items-center gap-3">
        {canSubmit && (
          <Button onClick={handleSubmit} disabled={busy}>{busy ? "Submitting..." : "Submit"}</Button>
        )}
        {canReceive && !receiving && (
          <Button onClick={() => setReceiving(true)}>Receive Items</Button>
        )}
        {canReceive && receiving && (
          <>
            <Button onClick={handleReceive} disabled={busy}>{busy ? "Saving..." : "Confirm Receiving"}</Button>
            <Button variant="outline" onClick={() => setReceiving(false)}>Cancel</Button>
          </>
        )}
        {canCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-[var(--color-destructive)]">Cancel PO</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel {po.poNumber}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This purchase order will be marked cancelled and can no longer be submitted or received against.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Never mind</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleCancel}
                  className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
                >
                  Cancel Purchase Order
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  )
}
