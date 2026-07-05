"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Item = {
  squareCatalogObjId: string
  name: string
  categoryName: string | null
  unitOfMeasure: string | null
  unitCostOverride: number | null
}

type Line = {
  squareCatalogObjId: string
  itemName: string
  quantityOrdered: string
  unitOfMeasure: string
  unitCost: string
  hint: string | null
}

export function NewPurchaseOrderClient({
  stores,
  vendors,
  items,
}: {
  stores: { id: string; name: string }[]
  vendors: { id: string; name: string }[]
  items: Item[]
}) {
  const router = useRouter()
  const [storeId, setStoreId] = useState("")
  const [vendorId, setVendorId] = useState("")
  const [expectedAt, setExpectedAt] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [itemSearch, setItemSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return []
    const q = itemSearch.trim().toLowerCase()
    return items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8)
  }, [itemSearch, items])

  async function addItem(item: Item) {
    const newLine: Line = {
      squareCatalogObjId: item.squareCatalogObjId,
      itemName: item.name,
      quantityOrdered: "1",
      unitOfMeasure: item.unitOfMeasure ?? "",
      unitCost: item.unitCostOverride?.toString() ?? "",
      hint: null,
    }
    setLines((prev) => [...prev, newLine])
    setItemSearch("")

    if (vendorId) {
      try {
        const res = await fetch(`/api/inventory/items/${item.squareCatalogObjId}/vendor-prices`)
        const prices: { vendorId: string; vendor: { name: string }; perUnitCost: number | null; isCheapest: boolean }[] = await res.json()
        const currentVendorPrice = prices.find((p) => p.vendorId === vendorId)
        const cheaper = prices.find((p) => p.isCheapest && p.vendorId !== vendorId && p.perUnitCost != null)
        if (cheaper && (!currentVendorPrice?.perUnitCost || cheaper.perUnitCost! < currentVendorPrice.perUnitCost)) {
          setLines((prev) =>
            prev.map((l) =>
              l.squareCatalogObjId === item.squareCatalogObjId && l.hint === null
                ? { ...l, hint: `${cheaper.vendor.name} offers this for $${cheaper.perUnitCost!.toFixed(2)}/unit` }
                : l
            )
          )
        }
      } catch {
        // Pricing comparison is a nice-to-have; ignore failures silently.
      }
    }
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0), 0)

  function buildPayload() {
    return {
      storeId,
      vendorId,
      invoiceNumber: invoiceNumber || null,
      expectedAt: expectedAt ? new Date(expectedAt).toISOString() : null,
      lines: lines.map((l) => ({
        squareCatalogObjId: l.squareCatalogObjId,
        itemName: l.itemName,
        quantityOrdered: Number(l.quantityOrdered) || 0,
        unitOfMeasure: l.unitOfMeasure || null,
        unitCost: Number(l.unitCost) || 0,
      })),
    }
  }

  async function handleSave(thenSubmit: boolean) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/inventory/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to save purchase order")
        return
      }
      if (thenSubmit) {
        const submitRes = await fetch(`/api/inventory/purchase-orders/${data.id}/submit`, { method: "POST" })
        if (!submitRes.ok) {
          const submitData = await submitRes.json().catch(() => ({}))
          setError(submitData.error ?? "Saved as draft, but submit failed")
          router.push(`/inventory/purchase-orders/${data.id}`)
          return
        }
      }
      router.push(`/inventory/purchase-orders/${data.id}`)
    } finally {
      setSaving(false)
    }
  }

  const canSave = storeId && vendorId && lines.length > 0 && lines.every((l) => Number(l.quantityOrdered) > 0)

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">New Purchase Order</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Pick a store and vendor, then add items to order.</p>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 mb-6">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label>Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger><SelectValue placeholder="Select a store" /></SelectTrigger>
              <SelectContent>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Select a vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Expected Date</Label>
            <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
          </div>
          <div>
            <Label>Invoice # (optional)</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
        </div>

        <Label>Add Item</Label>
        <div className="relative">
          <Input
            placeholder="Search items..."
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
          />
          {filteredItems.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-[var(--color-popover)] border border-[var(--color-border)] rounded-md shadow-md max-h-64 overflow-y-auto">
              {filteredItems.map((item) => (
                <button
                  key={item.squareCatalogObjId}
                  onClick={() => addItem(item)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent)] transition-colors"
                >
                  <span className="font-medium text-[var(--color-foreground)]">{item.name}</span>
                  {item.categoryName && <span className="text-xs text-[var(--color-muted-foreground)] ml-2">{item.categoryName}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Item", "Qty", "Unit", "Unit Cost", "Line Total", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2">
                    <p className="text-sm text-[var(--color-foreground)]">{line.itemName}</p>
                    {line.hint && <p className="text-xs text-[var(--color-warning-text)]">{line.hint}</p>}
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      className="h-8 w-20 text-sm"
                      value={line.quantityOrdered}
                      onChange={(e) => updateLine(i, { quantityOrdered: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      className="h-8 w-20 text-sm"
                      value={line.unitOfMeasure}
                      onChange={(e) => updateLine(i, { unitOfMeasure: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      className="h-8 w-24 text-sm"
                      value={line.unitCost}
                      onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2 text-sm text-[var(--color-foreground)]">
                    ${((Number(line.quantityOrdered) || 0) * (Number(line.unitCost) || 0)).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => removeLine(i)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                      <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end">
            <p className="text-sm font-medium text-[var(--color-foreground)]">Total: ${total.toFixed(2)}</p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-destructive)] mb-4">{error}</p>}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => handleSave(false)} disabled={!canSave || saving}>
          {saving ? "Saving..." : "Save Draft"}
        </Button>
        <Button onClick={() => handleSave(true)} disabled={!canSave || saving}>
          {saving ? "Saving..." : "Save & Submit"}
        </Button>
      </div>
    </div>
  )
}
