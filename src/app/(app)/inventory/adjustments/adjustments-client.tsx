"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeftRight, PackageMinus, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { compatibleUnits } from "@/lib/units"
import { RecordPrepDialog } from "../recipes/recipes-client"

type IngredientOption = {
  id: string
  displayName: string
  reportingUnit: string
  costPerReportingUnit: number
  isPrepared: boolean
}

type AdjustmentRow = {
  id: string
  storeId: string
  ingredientName: string
  type: string
  quantity: number
  costPerReportingUnit: number
  value: number
  reason: string | null
  occurredAt: string
  store: { name: string } | null
  lossReason: { label: string } | null
  group: {
    id: string
    type: string
    fromStoreId: string | null
    toStoreId: string | null
    destinationLabel: string | null
    recipeId: string | null
    batchMultiplier: number | null
    note: string | null
  } | null
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" })
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })

const TYPE_LABEL: Record<string, string> = {
  WASTE: "Waste",
  COMP: "Comp",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  CORRECTION: "Correction",
  PREP_CONSUME: "Prep used",
  PREP_PRODUCE: "Prep made",
}

const TYPE_FILTERS: Record<string, string[]> = {
  loss: ["WASTE", "COMP"],
  transfer: ["TRANSFER_IN", "TRANSFER_OUT"],
  prep: ["PREP_CONSUME", "PREP_PRODUCE"],
  correction: ["CORRECTION"],
}

function TypeBadge({ type }: { type: string }) {
  const label = TYPE_LABEL[type] ?? type
  if (type === "TRANSFER_IN" || type === "PREP_PRODUCE")
    return <Badge className="bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-transparent">{label}</Badge>
  if (type === "CORRECTION")
    return <Badge className="bg-[var(--color-info-bg)] text-[var(--color-info-text)] border-transparent">{label}</Badge>
  if (type === "WASTE" || type === "COMP")
    return <Badge className="bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-transparent">{label}</Badge>
  return <Badge variant="secondary">{label}</Badge>
}

export function AdjustmentsClient({
  stores,
  allStores,
  ingredients,
  lossReasons,
  destinations,
  prepRecipes,
  isManager,
}: {
  stores: { id: string; name: string }[]
  allStores: { id: string; name: string }[]
  ingredients: IngredientOption[]
  lossReasons: { id: string; label: string }[]
  destinations: string[]
  prepRecipes: { id: string; name: string; yieldQty: number; yieldUnit: string }[]
  isManager: boolean
}) {
  const [storeFilter, setStoreFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [rows, setRows] = useState<AdjustmentRow[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState<"quick" | "transfer" | "loss" | null>(null)
  const [rePrep, setRePrep] = useState<{ row: AdjustmentRow; recipe: { id: string; name: string; yieldQty: number; yieldUnit: string } } | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams()
    if (storeFilter !== "all") params.set("storeId", storeFilter)
    if (typeFilter !== "all") params.set("types", TYPE_FILTERS[typeFilter].join(","))
    if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString())
    if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString())
    fetch(`/api/inventory/adjustments?${params}`)
      .then((res): Promise<AdjustmentRow[]> => (res.ok ? res.json() : Promise.resolve([])))
      .then(setRows)
      .catch(() => setRows([]))
  }, [storeFilter, typeFilter, from, to])

  useEffect(() => {
    load()
  }, [load])

  function done(message: string) {
    setOpenDialog(null)
    setRePrep(null)
    setNotice(message)
    load()
    setTimeout(() => setNotice(null), 4000)
  }

  const storeName = useMemo(() => new Map(allStores.map((s) => [s.id, s.name])), [allStores])

  function contextFor(row: AdjustmentRow): string {
    if (row.group?.type === "TRANSFER") {
      const fromName = row.group.fromStoreId ? storeName.get(row.group.fromStoreId) ?? "?" : "?"
      const toName = row.group.destinationLabel ?? (row.group.toStoreId ? storeName.get(row.group.toStoreId) ?? "?" : "?")
      return `${fromName} → ${toName}${row.group.note ? ` · ${row.group.note}` : ""}`
    }
    const bits = [row.lossReason?.label, row.reason, row.group?.note].filter(Boolean)
    return bits.join(" · ")
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Adjustments</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Waste, comps, transfers between stores, prep batches and corrections — all dated so they land in the right
            inventory period.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setOpenDialog("transfer")} disabled={stores.length === 0}>
            <ArrowLeftRight className="h-4 w-4 mr-2" /> Transfer
          </Button>
          <Button variant="outline" onClick={() => setOpenDialog("loss")} disabled={stores.length === 0}>
            <PackageMinus className="h-4 w-4 mr-2" /> Log Loss
          </Button>
          <Button onClick={() => setOpenDialog("quick")} disabled={stores.length === 0}>
            <Plus className="h-4 w-4 mr-2" /> Quick Log
          </Button>
        </div>
      </div>

      {notice && (
        <div className="bg-[var(--color-success-bg)] text-[var(--color-success-text)] text-sm rounded-lg px-4 py-2.5 mb-4">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All my stores</SelectItem>
            {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="loss">Waste &amp; comps</SelectItem>
            <SelectItem value="transfer">Transfers</SelectItem>
            <SelectItem value="prep">Prep</SelectItem>
            <SelectItem value="correction">Corrections</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
        <span className="text-xs text-[var(--color-muted-foreground)]">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
      </div>

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
          <p className="text-sm mb-1">No adjustments yet.</p>
          <p className="text-xs">Log spoiled product with Quick Log, move stock with Transfer, or record a prep batch from Recipes → Prep Recipes.</p>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["When", "Store", "Item", "Type", "Qty", "Value", "Details", ""].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const prepRecipe = row.type === "PREP_PRODUCE" && row.group?.recipeId
                    ? prepRecipes.find((r) => r.id === row.group!.recipeId)
                    : null
                  return (
                    <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30">
                      <td className="px-4 py-2 text-sm text-[var(--color-foreground)] whitespace-nowrap">
                        {new Date(row.occurredAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2 text-sm text-[var(--color-foreground)]">{row.store?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-sm text-[var(--color-foreground)]">{row.ingredientName}</td>
                      <td className="px-4 py-2"><TypeBadge type={row.type} /></td>
                      <td className={`px-4 py-2 text-sm whitespace-nowrap ${row.quantity < 0 ? "text-[var(--color-destructive)]" : "text-[var(--color-foreground)]"}`}>
                        {row.quantity > 0 ? "+" : ""}{num(row.quantity)}
                      </td>
                      <td className={`px-4 py-2 text-sm whitespace-nowrap ${row.value < 0 ? "text-[var(--color-destructive)]" : "text-[var(--color-foreground)]"}`}>
                        {usd(row.value)}
                      </td>
                      <td className="px-4 py-2 text-xs text-[var(--color-muted-foreground)] max-w-[220px] truncate" title={contextFor(row)}>
                        {contextFor(row) || "—"}
                      </td>
                      <td className="px-4 py-2">
                        {prepRecipe && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={`Re-record ${prepRecipe.name} (${row.group?.batchMultiplier ?? 1}× batch)`}
                            onClick={() => setRePrep({ row, recipe: prepRecipe })}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Re-record
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <QuickLogDialog
        open={openDialog === "quick"}
        onClose={() => setOpenDialog(null)}
        stores={stores}
        ingredients={ingredients}
        lossReasons={lossReasons}
        isManager={isManager}
        onSaved={done}
      />
      <TransferDialog
        open={openDialog === "transfer"}
        onClose={() => setOpenDialog(null)}
        stores={stores}
        allStores={allStores}
        ingredients={ingredients}
        destinations={destinations}
        onSaved={done}
      />
      <LossDialog
        open={openDialog === "loss"}
        onClose={() => setOpenDialog(null)}
        stores={stores}
        ingredients={ingredients}
        lossReasons={lossReasons}
        isManager={isManager}
        onSaved={done}
      />
      {rePrep && (
        <RecordPrepDialog
          key={rePrep.row.id}
          recipe={rePrep.recipe}
          stores={stores}
          initialStoreId={rePrep.row.storeId}
          initialMultiplier={rePrep.row.group?.batchMultiplier ?? 1}
          onClose={() => setRePrep(null)}
          onRecorded={done}
        />
      )}
    </div>
  )
}

// ─── Shared multi-line editor (transfers + losses) ───────────────────────────

type EditableLine = { ingredientId: string; displayName: string; reportingUnit: string; quantity: string; unit: string }

function LinesEditor({
  ingredients,
  lines,
  setLines,
}: {
  ingredients: IngredientOption[]
  lines: EditableLine[]
  setLines: (updater: (prev: EditableLine[]) => EditableLine[]) => void
}) {
  const [search, setSearch] = useState("")

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return ingredients.filter((i) => i.displayName.toLowerCase().includes(q)).slice(0, 8)
  }, [search, ingredients])

  return (
    <div>
      <div className="relative">
        <Input placeholder="Search ingredients to add..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-[var(--color-popover)] border border-[var(--color-border)] rounded-md shadow-md max-h-56 overflow-y-auto">
            {results.map((ing) => (
              <button
                key={ing.id}
                onClick={() => {
                  setLines((prev) => [
                    ...prev,
                    { ingredientId: ing.id, displayName: ing.displayName, reportingUnit: ing.reportingUnit, quantity: "1", unit: ing.reportingUnit },
                  ])
                  setSearch("")
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent)] transition-colors"
              >
                <span className="font-medium text-[var(--color-foreground)]">{ing.displayName}</span>
                {ing.isPrepared && <Badge variant="secondary" className="ml-2 text-[10px]">prepared</Badge>}
                <span className="text-xs text-[var(--color-muted-foreground)] ml-2">{ing.reportingUnit}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <div className="mt-3 space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-[var(--color-foreground)] truncate">{line.displayName}</span>
              <Input
                type="number"
                step="any"
                min="0"
                className="h-8 w-24 text-sm"
                value={line.quantity}
                onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
              />
              <Select
                value={line.unit}
                onValueChange={(unit) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unit } : l)))}
              >
                <SelectTrigger className="h-8 w-28 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {compatibleUnits(line.reportingUnit).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
              <button
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                className="p-1 rounded hover:bg-[var(--color-accent)]"
              >
                <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Quick log (single row: waste / comp / correction) ───────────────────────

function QuickLogDialog({
  open,
  onClose,
  stores,
  ingredients,
  lossReasons,
  isManager,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  stores: { id: string; name: string }[]
  ingredients: IngredientOption[]
  lossReasons: { id: string; label: string }[]
  isManager: boolean
  onSaved: (message: string) => void
}) {
  const [storeId, setStoreId] = useState(stores.length === 1 ? stores[0].id : "")
  const [type, setType] = useState("WASTE")
  const [ingredient, setIngredient] = useState<IngredientOption | null>(null)
  const [search, setSearch] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [unit, setUnit] = useState("")
  const [lossReasonId, setLossReasonId] = useState(lossReasons[0]?.id ?? "")
  const [reason, setReason] = useState("")
  const [occurredAt, setOccurredAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return ingredients.filter((i) => i.displayName.toLowerCase().includes(q)).slice(0, 8)
  }, [search, ingredients])

  async function save() {
    if (!ingredient) return
    setSaving(true)
    setError(null)
    try {
      const qty = Number(quantity)
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          ingredientId: ingredient.id,
          type,
          quantity: qty,
          unit: unit || ingredient.reportingUnit,
          ...(type !== "CORRECTION" && lossReasonId ? { lossReasonId } : {}),
          reason: reason || null,
          ...(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to log adjustment")
        return
      }
      onSaved(`Logged ${TYPE_LABEL[type].toLowerCase()} — ${ingredient.displayName}.`)
    } finally {
      setSaving(false)
    }
  }

  const qtyNum = Number(quantity)
  const canSave = storeId && ingredient && (type === "CORRECTION" ? qtyNum !== 0 : qtyNum > 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick Log</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
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
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WASTE">Waste / spoilage</SelectItem>
                  <SelectItem value="COMP">Comp / given away</SelectItem>
                  {isManager && <SelectItem value="CORRECTION">Correction (+/−)</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Ingredient</Label>
            {ingredient ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="flex-1 text-sm text-[var(--color-foreground)]">{ingredient.displayName}</span>
                <Button size="sm" variant="ghost" onClick={() => { setIngredient(null); setUnit("") }}>Change</Button>
              </div>
            ) : (
              <div className="relative">
                <Input placeholder="Search ingredients..." value={search} onChange={(e) => setSearch(e.target.value)} />
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-[var(--color-popover)] border border-[var(--color-border)] rounded-md shadow-md max-h-48 overflow-y-auto">
                    {results.map((ing) => (
                      <button
                        key={ing.id}
                        onClick={() => { setIngredient(ing); setUnit(ing.reportingUnit); setSearch("") }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent)] transition-colors"
                      >
                        {ing.displayName}
                        <span className="text-xs text-[var(--color-muted-foreground)] ml-2">{ing.reportingUnit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{type === "CORRECTION" ? "Quantity (+ adds, − removes)" : "Quantity"}</Label>
              <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={unit} onValueChange={setUnit} disabled={!ingredient}>
                <SelectTrigger><SelectValue placeholder="unit" /></SelectTrigger>
                <SelectContent>
                  {(ingredient ? compatibleUnits(ingredient.reportingUnit) : []).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {type !== "CORRECTION" && (
            <div>
              <Label>Reason</Label>
              <Select value={lossReasonId} onValueChange={setLossReasonId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {lossReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>When (blank = now)</Label>
              <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!canSave || saving}>{saving ? "Saving..." : "Log it"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Transfer (multi-line, paired rows, custom destinations) ─────────────────

function TransferDialog({
  open,
  onClose,
  stores,
  allStores,
  ingredients,
  destinations,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  stores: { id: string; name: string }[]
  allStores: { id: string; name: string }[]
  ingredients: IngredientOption[]
  destinations: string[]
  onSaved: (message: string) => void
}) {
  const CUSTOM = "__custom__"
  const [fromStoreId, setFromStoreId] = useState(stores.length === 1 ? stores[0].id : "")
  const [toValue, setToValue] = useState("")
  const [destinationLabel, setDestinationLabel] = useState("")
  const [occurredAt, setOccurredAt] = useState("")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<EditableLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCustom = toValue === CUSTOM

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/inventory/adjustments/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromStoreId,
          toStoreId: isCustom ? null : toValue,
          destinationLabel: isCustom ? destinationLabel.trim() : null,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
          note: note || null,
          lines: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to save transfer")
        return
      }
      onSaved(`Transfer saved — ${lines.length} line${lines.length === 1 ? "" : "s"}.`)
      setLines([])
      setNote("")
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    fromStoreId &&
    (isCustom ? destinationLabel.trim().length > 0 : !!toValue && toValue !== fromStoreId) &&
    lines.length > 0 &&
    lines.every((l) => Number(l.quantity) > 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From store</Label>
              <Select value={fromStoreId} onValueChange={setFromStoreId}>
                <SelectTrigger><SelectValue placeholder="Sending store" /></SelectTrigger>
                <SelectContent>
                  {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select value={toValue} onValueChange={setToValue}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  {allStores.filter((s) => s.id !== fromStoreId).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Custom destination…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isCustom && (
            <div>
              <Label>Destination name</Label>
              <Input
                list="destination-suggestions"
                placeholder={'e.g. "Kitchen" or "Catering — Smith wedding"'}
                value={destinationLabel}
                onChange={(e) => setDestinationLabel(e.target.value)}
              />
              <datalist id="destination-suggestions">
                {destinations.map((d) => <option key={d} value={d} />)}
              </datalist>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                Outbound only — stock leaves this store without arriving at another tracked store.
              </p>
            </div>
          )}
          <LinesEditor ingredients={ingredients} lines={lines} setLines={setLines} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>When (blank = now)</Label>
              <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Backdate to land in the right inventory period.</p>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!canSave || saving}>{saving ? "Saving..." : "Save Transfer"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Loss entry (multi-line, mirrors transfers) ───────────────────────────────

function LossDialog({
  open,
  onClose,
  stores,
  ingredients,
  lossReasons,
  isManager,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  stores: { id: string; name: string }[]
  ingredients: IngredientOption[]
  lossReasons: { id: string; label: string }[]
  isManager: boolean
  onSaved: (message: string) => void
}) {
  const [storeId, setStoreId] = useState(stores.length === 1 ? stores[0].id : "")
  const [type, setType] = useState("WASTE")
  const [lossReasonId, setLossReasonId] = useState(lossReasons[0]?.id ?? "")
  const [customReason, setCustomReason] = useState("")
  const [addingReason, setAddingReason] = useState(false)
  const [reasons, setReasons] = useState(lossReasons)
  const [occurredAt, setOccurredAt] = useState("")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<EditableLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addReason() {
    const label = customReason.trim()
    if (!label) return
    const res = await fetch("/api/inventory/loss-reasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    })
    const data = await res.json()
    if (res.ok) {
      setReasons((prev) => [...prev, { id: data.id, label: data.label }])
      setLossReasonId(data.id)
      setCustomReason("")
      setAddingReason(false)
    } else {
      setError(data.error ?? "Couldn't add reason")
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/inventory/adjustments/losses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          type,
          lossReasonId,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
          note: note || null,
          lines: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to save loss entry")
        return
      }
      onSaved(`Loss entry saved — ${lines.length} line${lines.length === 1 ? "" : "s"}.`)
      setLines([])
      setNote("")
    } finally {
      setSaving(false)
    }
  }

  const canSave = storeId && lossReasonId && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log loss</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
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
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WASTE">Waste</SelectItem>
                  <SelectItem value="COMP">Comp</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Reason</Label>
            <div className="flex items-center gap-2">
              <Select value={lossReasonId} onValueChange={setLossReasonId}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {isManager && !addingReason && (
                <Button size="sm" variant="ghost" onClick={() => setAddingReason(true)}>+ Custom</Button>
              )}
            </div>
            {addingReason && (
              <div className="flex items-center gap-2 mt-2">
                <Input placeholder="New reason label" value={customReason} onChange={(e) => setCustomReason(e.target.value)} />
                <Button size="sm" onClick={addReason} disabled={!customReason.trim()}>Add</Button>
              </div>
            )}
          </div>
          <LinesEditor ingredients={ingredients} lines={lines} setLines={setLines} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>When (blank = now)</Label>
              <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!canSave || saving}>{saving ? "Saving..." : "Save Loss Entry"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
