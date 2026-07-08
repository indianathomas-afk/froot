"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { WEEKDAY_LABELS, parseDeliveryDays } from "@/lib/vendor-delivery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type Vendor = {
  id: string
  name: string
  accountNumber: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  terms: string | null
  leadTimeDays: number | null
  minOrderCases: number | null
  minOrderDollars: number | null
  deliveryDays: unknown
  notes: string | null
  isActive: boolean
}

type AdjustmentRow = {
  id?: string
  name: string
  type: "FLAT" | "PERCENT"
  value: string
  glCode: string
  isActive: boolean
}

const emptyForm = {
  name: "",
  accountNumber: "",
  contactName: "",
  email: "",
  phone: "",
  terms: "",
  leadTimeDays: "",
  minOrderCases: "",
  minOrderDollars: "",
  notes: "",
}

export function VendorsClient({ vendors, canManage }: { vendors: Vendor[]; canManage: boolean }) {
  const router = useRouter()
  const [dialogVendor, setDialogVendor] = useState<Vendor | null | undefined>(undefined)

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Vendors</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Suppliers you order from, with lead time and payment terms.</p>
        </div>
        {canManage && (
          <Button onClick={() => setDialogVendor(null)}>
            <Plus className="h-4 w-4" />
            New Vendor
          </Button>
        )}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {vendors.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No vendors yet. Add your first supplier to start creating purchase orders.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["Vendor", "Contact", "Terms", "Delivery", "Minimums", "Status", ""].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{v.name}</p>
                      {v.accountNumber && <p className="text-xs text-[var(--color-muted-foreground)]">Acct #{v.accountNumber}</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {v.contactName ?? "—"}
                      {v.email && <p className="text-xs">{v.email}</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">{v.terms ?? "—"}</td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {parseDeliveryDays(v.deliveryDays).length > 0
                        ? parseDeliveryDays(v.deliveryDays).map((d) => WEEKDAY_LABELS[d]).join(", ")
                        : v.leadTimeDays != null
                          ? `${v.leadTimeDays} day${v.leadTimeDays !== 1 ? "s" : ""} lead`
                          : "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {v.minOrderCases != null || v.minOrderDollars != null ? (
                        <>
                          {v.minOrderCases != null && <span>{v.minOrderCases} cases</span>}
                          {v.minOrderCases != null && v.minOrderDollars != null && " / "}
                          {v.minOrderDollars != null && <span>${v.minOrderDollars.toFixed(0)}</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={v.isActive ? "success" : "secondary"}>{v.isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-6 py-4">
                      {canManage && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setDialogVendor(v)}
                            className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors"
                          >
                            <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          </button>
                          <DeleteVendorButton vendorId={v.id} vendorName={v.name} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VendorDialog
        vendor={dialogVendor}
        onClose={() => setDialogVendor(undefined)}
        onSaved={() => {
          setDialogVendor(undefined)
          router.refresh()
        }}
      />
    </div>
  )
}

function VendorDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: Vendor | null | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const isOpen = vendor !== undefined
  const [form, setForm] = useState(emptyForm)
  const [deliveryDays, setDeliveryDays] = useState<number[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form contents whenever the dialog opens for a (possibly different) vendor.
  const [lastVendorId, setLastVendorId] = useState<string | null | undefined>(undefined)
  if (isOpen && vendor?.id !== lastVendorId) {
    setLastVendorId(vendor?.id ?? null)
    setForm(
      vendor
        ? {
            name: vendor.name,
            accountNumber: vendor.accountNumber ?? "",
            contactName: vendor.contactName ?? "",
            email: vendor.email ?? "",
            phone: vendor.phone ?? "",
            terms: vendor.terms ?? "",
            leadTimeDays: vendor.leadTimeDays?.toString() ?? "",
            minOrderCases: vendor.minOrderCases?.toString() ?? "",
            minOrderDollars: vendor.minOrderDollars?.toString() ?? "",
            notes: vendor.notes ?? "",
          }
        : emptyForm
    )
    setDeliveryDays(vendor ? parseDeliveryDays(vendor.deliveryDays) : [])
    setAdjustments([])
    setError(null)
  }

  // Standing adjustments exist only for saved vendors.
  const vendorId = vendor?.id ?? null
  useEffect(() => {
    if (!vendorId) return
    let cancelled = false
    fetch(`/api/inventory/vendors/${vendorId}/adjustments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { id: string; name: string; type: string; value: number; glCode: string | null; isActive: boolean }[]) => {
        if (cancelled) return
        setAdjustments(
          rows.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type === "PERCENT" ? "PERCENT" : "FLAT",
            value: String(a.value),
            glCode: a.glCode ?? "",
            isActive: a.isActive,
          }))
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [vendorId])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name,
        accountNumber: form.accountNumber || null,
        contactName: form.contactName || null,
        email: form.email || null,
        phone: form.phone || null,
        terms: form.terms || null,
        leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
        minOrderCases: form.minOrderCases ? Number(form.minOrderCases) : null,
        minOrderDollars: form.minOrderDollars ? Number(form.minOrderDollars) : null,
        deliveryDays,
        notes: form.notes || null,
      }
      const res = await fetch(vendor ? `/api/inventory/vendors/${vendor.id}` : "/api/inventory/vendors", {
        method: vendor ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Save failed")
        return
      }
      if (vendor) {
        const valid = adjustments.filter((a) => a.name.trim() && Number.isFinite(Number(a.value)))
        const adjRes = await fetch(`/api/inventory/vendors/${vendor.id}/adjustments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            valid.map((a) => ({
              ...(a.id ? { id: a.id } : {}),
              name: a.name.trim(),
              type: a.type,
              value: Number(a.value),
              glCode: a.glCode.trim() || null,
              isActive: a.isActive,
            }))
          ),
        })
        if (!adjRes.ok) {
          const data = await adjRes.json().catch(() => ({}))
          setError(data.error ?? "Vendor saved, but adjustments failed to save")
          return
        }
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vendor ? "Edit Vendor" : "New Vendor"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Account Number</Label>
              <Input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Terms</Label>
              <Input placeholder="Net 30" value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} />
            </div>
            <div>
              <Label>Lead Time (days)</Label>
              <Input type="number" value={form.leadTimeDays} onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))} />
            </div>
            <div>
              <Label>Min Order (cases)</Label>
              <Input
                type="number"
                min={0}
                placeholder="No minimum"
                value={form.minOrderCases}
                onChange={(e) => setForm((f) => ({ ...f, minOrderCases: e.target.value }))}
              />
            </div>
            <div>
              <Label>Min Order ($)</Label>
              <Input
                type="number"
                min={0}
                placeholder="No minimum"
                value={form.minOrderDollars}
                onChange={(e) => setForm((f) => ({ ...f, minOrderDollars: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Delivery Days</Label>
            <div className="flex items-center gap-1 mt-1">
              {WEEKDAY_LABELS.map((label, day) => {
                const active = deliveryDays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setDeliveryDays((prev) => (active ? prev.filter((d) => d !== day) : [...prev, day].sort()))
                    }
                    className={
                      "px-2 py-1 rounded text-xs border transition-colors " +
                      (active
                        ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]")
                    }
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              New orders default their expected date to the next delivery day.
            </p>
          </div>
          {vendor && (
            <div>
              <div className="flex items-center justify-between">
                <Label>Standing Invoice Adjustments</Label>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    setAdjustments((prev) => [...prev, { name: "", type: "FLAT", value: "", glCode: "", isActive: true }])
                  }
                >
                  Add
                </Button>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
                Fees, deposits, or credits auto-attached when receiving this vendor&apos;s orders. Negative = credit.
              </p>
              <div className="space-y-2">
                {adjustments.map((a, i) => (
                  <div key={a.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-8 w-36 text-sm"
                      placeholder="Fuel surcharge"
                      value={a.name}
                      onChange={(e) => setAdjustments((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <select
                      className="h-8 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm"
                      value={a.type}
                      onChange={(e) =>
                        setAdjustments((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, type: e.target.value as "FLAT" | "PERCENT" } : x))
                        )
                      }
                    >
                      <option value="FLAT">$ flat</option>
                      <option value="PERCENT">% of order</option>
                    </select>
                    <Input
                      type="number"
                      className="h-8 w-20 text-sm"
                      placeholder={a.type === "FLAT" ? "5.00" : "3"}
                      value={a.value}
                      onChange={(e) => setAdjustments((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    />
                    <Input
                      className="h-8 w-20 text-sm"
                      placeholder="GL code"
                      value={a.glCode}
                      onChange={(e) => setAdjustments((prev) => prev.map((x, j) => (j === i ? { ...x, glCode: e.target.value } : x)))}
                    />
                    <label className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                      <input
                        type="checkbox"
                        checked={a.isActive}
                        onChange={(e) =>
                          setAdjustments((prev) => prev.map((x, j) => (j === i ? { ...x, isActive: e.target.checked } : x)))
                        }
                      />
                      active
                    </label>
                    <button
                      type="button"
                      onClick={() => setAdjustments((prev) => prev.filter((_, j) => j !== i))}
                      className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteVendorButton({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/inventory/vendors/${vendorId}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors">
          <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {vendorName}?</AlertDialogTitle>
          <AlertDialogDescription>
            If this vendor has purchase order history, it will be deactivated instead of deleted so past orders stay intact.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
