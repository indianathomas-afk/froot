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
  ingredientId: string
  ingredientName: string
  purchaseUnitLabel: string
  quantityOrdered: number
  quantityReceived: number
  unitCost: number
  lineTotal: number
  receivingNote: string | null
  vendorCasePrice: number | null
}

type PoAdjustment = {
  id: string
  vendorAdjustmentId: string | null
  name: string
  type: string
  value: number
  amount: number
  glCode: string | null
}

type VendorAdjustment = {
  id: string
  name: string
  type: string
  value: number
  glCode: string | null
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
  vendor: { name: string; activeAdjustments: VendorAdjustment[] }
  lines: Line[]
  adjustments: PoAdjustment[]
}

// Editable adjustment row while receiving.
type AdjustmentDraft = {
  vendorAdjustmentId: string | null
  name: string
  type: "FLAT" | "PERCENT"
  value: number
  amount: string
  glCode: string
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
  const [notice, setNotice] = useState<string | null>(null)
  const [receiveInputs, setReceiveInputs] = useState<Record<string, { qty: string; note: string }>>(
    Object.fromEntries(po.lines.map((l) => [l.id, { qty: String(l.quantityOrdered - l.quantityReceived), note: "" }]))
  )
  // Invoice adjustments confirmed at receive time: existing PO adjustments if
  // any, else the vendor's standing active adjustments (I-7 auto-attach).
  const linesTotal = po.lines.reduce((s, l) => s + l.lineTotal, 0)
  const [adjustmentDrafts, setAdjustmentDrafts] = useState<AdjustmentDraft[]>(() =>
    po.adjustments.length > 0
      ? po.adjustments.map((a) => ({
          vendorAdjustmentId: a.vendorAdjustmentId,
          name: a.name,
          type: a.type === "PERCENT" ? "PERCENT" : "FLAT",
          value: a.value,
          amount: a.amount.toFixed(2),
          glCode: a.glCode ?? "",
        }))
      : po.vendor.activeAdjustments.map((a) => ({
          vendorAdjustmentId: a.id,
          name: a.name,
          type: a.type === "PERCENT" ? ("PERCENT" as const) : ("FLAT" as const),
          value: a.value,
          amount: (a.type === "PERCENT" ? (a.value / 100) * linesTotal : a.value).toFixed(2),
          glCode: a.glCode ?? "",
        }))
  )
  const adjustmentsTotal = po.adjustments.reduce((s, a) => s + a.amount, 0)

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
    setNotice(null)
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

      const adjustments = adjustmentDrafts
        .filter((a) => a.name.trim() && Number.isFinite(Number(a.amount)))
        .map((a) => ({
          vendorAdjustmentId: a.vendorAdjustmentId,
          name: a.name.trim(),
          type: a.type,
          value: a.value,
          amount: Number(a.amount),
          glCode: a.glCode.trim() || null,
        }))

      const res = await fetch(`/api/inventory/purchase-orders/${po.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipts: payload, adjustments }),
      })
      const data = await res.json()
      if (!res.ok) return setError(data.error ?? "Failed to receive")
      setReceiving(false)
      const changed = data.changedCosts?.length ?? 0
      if (changed > 0) setNotice(`Received items — ${changed} item cost${changed !== 1 ? "s" : ""} updated.`)
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
          {adjustmentsTotal !== 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              + ${adjustmentsTotal.toFixed(2)} adjustments = ${(po.totalAmount + adjustmentsTotal).toFixed(2)} invoice
            </p>
          )}
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

      {/* Invoice adjustments — editable while receiving, read-only after */}
      {receiving && canReceive ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-[var(--color-foreground)]">Invoice adjustments</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setAdjustmentDrafts((prev) => [
                  ...prev,
                  { vendorAdjustmentId: null, name: "", type: "FLAT", value: 0, amount: "", glCode: "" },
                ])
              }
            >
              Add adjustment
            </Button>
          </div>
          {adjustmentDrafts.length === 0 ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              No adjustments — fees, deposits, or credits on the invoice can be added here.
            </p>
          ) : (
            <div className="space-y-2">
              {adjustmentDrafts.map((a, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="h-8 w-44 text-sm"
                    placeholder="Name (e.g. Fuel surcharge)"
                    value={a.name}
                    onChange={(e) =>
                      setAdjustmentDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[var(--color-muted-foreground)]">$</span>
                    <Input
                      type="number"
                      className="h-8 w-24 text-sm"
                      placeholder="0.00"
                      value={a.amount}
                      onChange={(e) =>
                        setAdjustmentDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                      }
                    />
                  </div>
                  <Input
                    className="h-8 w-24 text-sm"
                    placeholder="GL code"
                    value={a.glCode}
                    onChange={(e) =>
                      setAdjustmentDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, glCode: e.target.value } : x)))
                    }
                  />
                  {a.vendorAdjustmentId && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      standing{a.type === "PERCENT" ? ` (${a.value}%)` : ""}
                    </span>
                  )}
                  <button
                    onClick={() => setAdjustmentDrafts((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : po.adjustments.length > 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 mb-6">
          <p className="text-sm font-medium text-[var(--color-foreground)] mb-2">Invoice adjustments</p>
          <div className="space-y-1">
            {po.adjustments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-muted-foreground)]">
                  {a.name}
                  {a.glCode ? ` · GL ${a.glCode}` : ""}
                </span>
                <span className="text-[var(--color-foreground)]">${a.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {notice && <p className="text-sm text-[var(--color-success-text)] mb-4">{notice}</p>}
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
