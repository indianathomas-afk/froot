"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDistanceToNow } from "date-fns"

type Vendor = { id: string; name: string }

type Variation = {
  id: string
  name: string
  sku: string | null
  priceMoney: number | null
  ordinal: number
}

type Metadata = {
  vendorName: string | null
  vendorId: string | null
  glCode: string | null
  parLevel: number | null
  unitCostOverride: number | null
  unitOfMeasure: string | null
  notes: string | null
} | null

type Item = {
  id: string
  squareCatalogObjId: string
  name: string
  description: string | null
  categoryId: string | null
  categoryName: string | null
  isArchived: boolean
  productType: string | null
  variations: Variation[]
  metadata: Metadata
}

type Category = { id: string; name: string }

function formatPrice(cents: number | null) {
  if (cents === null) return "—"
  return `$${(cents / 100).toFixed(2)}`
}

export function ItemsClient({
  items,
  categories,
  vendors,
  isAdmin,
  lastCatalogSyncAt,
  squareConnected,
}: {
  items: Item[]
  categories: Category[]
  vendors: Vendor[]
  isAdmin: boolean
  lastCatalogSyncAt: string | null
  squareConnected: boolean
}) {
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [showArchived, setShowArchived] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!showArchived && item.isArchived) return false
      if (categoryFilter !== "all" && item.categoryId !== categoryFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (!item.name.toLowerCase().includes(q) && !item.description?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [items, search, categoryFilter, showArchived])

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Items</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Catalog items synced from Square — set vendor, GL code, par level, and cost overrides.
          </p>
        </div>
        {isAdmin && <SyncButton squareConnected={squareConnected} lastCatalogSyncAt={lastCatalogSyncAt} />}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Input
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {items.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm mb-1">No items yet.</p>
            <p className="text-xs">
              {squareConnected
                ? isAdmin
                  ? "Click \"Sync from Square\" to import your catalog."
                  : "Ask an admin to sync the Square catalog."
                : "Connect Square in Settings, then sync your catalog."}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No items match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["", "Item", "Category", "Variations", "Vendor", "Par Level", "Unit Cost"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    vendors={vendors}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ItemRow({ item, vendors, expanded, onToggle }: { item: Item; vendors: Vendor[]; expanded: boolean; onToggle: () => void }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    vendorId: item.metadata?.vendorId ?? "",
    glCode: item.metadata?.glCode ?? "",
    parLevel: item.metadata?.parLevel?.toString() ?? "",
    unitCostOverride: item.metadata?.unitCostOverride?.toString() ?? "",
    unitOfMeasure: item.metadata?.unitOfMeasure ?? "",
    notes: item.metadata?.notes ?? "",
  })

  const vendorName = vendors.find((v) => v.id === item.metadata?.vendorId)?.name ?? item.metadata?.vendorName ?? null

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/items/${item.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: form.vendorId || null,
          glCode: form.glCode || null,
          parLevel: form.parLevel ? Number(form.parLevel) : null,
          unitCostOverride: form.unitCostOverride ? Number(form.unitCostOverride) : null,
          unitOfMeasure: form.unitOfMeasure || null,
          notes: form.notes || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Save failed")
        return
      }
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr
        className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3 w-8">
          {expanded ? <ChevronDown className="h-4 w-4 text-[var(--color-muted-foreground)]" /> : <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />}
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-medium text-[var(--color-foreground)]">{item.name}</p>
          {item.isArchived && <Badge variant="secondary" className="mt-1">Archived</Badge>}
        </td>
        <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{item.categoryName ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{item.variations.length}</td>
        <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{vendorName ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{item.metadata?.parLevel ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          {item.metadata?.unitCostOverride !== null && item.metadata?.unitCostOverride !== undefined
            ? `$${item.metadata.unitCostOverride.toFixed(2)}`
            : "—"}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[var(--color-border)] last:border-0 bg-[var(--color-accent)]/10">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-medium text-[var(--color-muted-foreground)] uppercase mb-2">Variations</h4>
                {item.variations.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">No variations</p>
                ) : (
                  <div className="space-y-1.5">
                    {item.variations.map((v) => (
                      <div key={v.id} className="flex items-center justify-between text-sm bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-1.5">
                        <span className="text-[var(--color-foreground)]">{v.name}</span>
                        <span className="text-[var(--color-muted-foreground)]">{v.sku ?? "no sku"} · {formatPrice(v.priceMoney)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-xs font-medium text-[var(--color-muted-foreground)] uppercase mb-2">Item Details</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div onClick={(e) => e.stopPropagation()}>
                    <label className="text-xs text-[var(--color-muted-foreground)]">Vendor</label>
                    <Select value={form.vendorId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v === "none" ? "" : v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="No vendor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No vendor</SelectItem>
                        {vendors.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!form.vendorId && item.metadata?.vendorName && (
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Previously: {item.metadata.vendorName}</p>
                    )}
                  </div>
                  <FieldInput label="GL Code" value={form.glCode} onChange={(v) => setForm((f) => ({ ...f, glCode: v }))} />
                  <FieldInput label="Par Level" value={form.parLevel} onChange={(v) => setForm((f) => ({ ...f, parLevel: v }))} type="number" />
                  <FieldInput label="Unit Cost" value={form.unitCostOverride} onChange={(v) => setForm((f) => ({ ...f, unitCostOverride: v }))} type="number" />
                  <FieldInput label="Unit of Measure" value={form.unitOfMeasure} onChange={(v) => setForm((f) => ({ ...f, unitOfMeasure: v }))} />
                  <FieldInput label="Notes" value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
                </div>
                {error && <p className="text-xs text-[var(--color-destructive)] mt-2">{error}</p>}
                <Button size="sm" className="mt-3" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <label className="text-xs text-[var(--color-muted-foreground)]">{label}</label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
    </div>
  )
}

function SyncButton({ squareConnected, lastCatalogSyncAt }: { squareConnected: boolean; lastCatalogSyncAt: string | null }) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSync() {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch("/api/square/catalog/sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "Sync failed" })
        return
      }
      setResult({ ok: true, message: `Synced ${data.categories} categories, ${data.items} items, ${data.variations} variations` })
      router.refresh()
    } catch {
      setResult({ ok: false, message: "Sync failed — check your connection" })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="text-right">
      <Button onClick={handleSync} disabled={syncing || !squareConnected} variant="outline">
        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing..." : "Sync from Square"}
      </Button>
      {!squareConnected && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Connect Square in Settings first</p>
      )}
      {lastCatalogSyncAt && !result && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
          Last synced {formatDistanceToNow(new Date(lastCatalogSyncAt), { addSuffix: true })}
        </p>
      )}
      {result && (
        <p className={`text-xs mt-1 ${result.ok ? "text-[var(--color-success-text)]" : "text-[var(--color-destructive)]"}`}>
          {result.message}
        </p>
      )}
    </div>
  )
}
