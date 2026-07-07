"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, ChefHat, CookingPot } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Item = {
  id: string
  displayName: string
  menuGroup: string | null
  priceCents: number | null
  recipeStatus: string
  recipeId: string | null
  cost: number | null
  costError: string | null
  costPct: number | null
}

type PrepRecipe = {
  id: string
  name: string
  yieldQty: number
  yieldUnit: string
  isActive: boolean
  cost: number | null
  costPerYieldUnit: number | null
  costError: string | null
  countable: boolean
  usedInCount: number
}

const usd = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" })
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`)
const price = (cents: number | null) => (cents === null ? "—" : usd(cents / 100))

function StatusBadge({ status }: { status: string }) {
  if (status === "MAPPED") return <Badge className="bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-transparent">Mapped</Badge>
  if (status === "NON_RECIPE") return <Badge variant="secondary">Non-recipe</Badge>
  return <Badge className="bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-transparent">Unmapped</Badge>
}

export function RecipesClient({
  items,
  prepRecipes,
  stores,
  isManager,
}: {
  items: Item[]
  prepRecipes: PrepRecipe[]
  stores: { id: string; name: string }[]
  isManager: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("attention")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [prepDialogRecipe, setPrepDialogRecipe] = useState<PrepRecipe | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const needsAttentionCount = useMemo(
    () => items.filter((i) => i.recipeStatus === "UNMAPPED" && (i.priceCents ?? 0) > 0).length,
    [items]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (q && !i.displayName.toLowerCase().includes(q)) return false
      if (statusFilter === "attention") return i.recipeStatus === "UNMAPPED" && (i.priceCents ?? 0) > 0
      if (statusFilter === "unmapped") return i.recipeStatus === "UNMAPPED"
      if (statusFilter === "mapped") return i.recipeStatus === "MAPPED"
      if (statusFilter === "non_recipe") return i.recipeStatus === "NON_RECIPE"
      return true
    })
  }, [items, search, statusFilter])

  // "Needs attention" reads best as one list, priciest first; everything else
  // groups by menu group — the way operators think about the menu.
  const grouped = useMemo((): [string, Item[]][] => {
    if (statusFilter === "attention") {
      return [["Needs attention — highest price first", [...filtered].sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0))]]
    }
    const groups = new Map<string, Item[]>()
    for (const item of filtered) {
      const key = item.menuGroup ?? "No menu group"
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, statusFilter])

  const selectableIds = useMemo(
    () => filtered.filter((i) => !i.recipeId).map((i) => i.id),
    [filtered]
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkSetStatus(recipeStatus: "NON_RECIPE" | "UNMAPPED") {
    setBulkBusy(true)
    try {
      const res = await fetch("/api/inventory/sales-items/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], recipeStatus }),
      })
      const data = await res.json()
      if (res.ok) {
        setNotice(`${data.updated} item${data.updated === 1 ? "" : "s"} updated`)
        setSelected(new Set())
        router.refresh()
        setTimeout(() => setNotice(null), 4000)
      } else {
        setNotice(data.error ?? "Update failed")
      }
    } finally {
      setBulkBusy(false)
    }
  }

  function openItem(item: Item) {
    if (item.recipeId) router.push(`/inventory/recipes/${item.recipeId}`)
    else router.push(`/inventory/recipes/new?salesItemId=${item.id}`)
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Recipes</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Map each sellable item to its ingredients for theoretical cost. Square data stays read-only.
          </p>
        </div>
        {isManager && (
          <Button onClick={() => router.push("/inventory/recipes/new")}>
            <ChefHat className="h-4 w-4 mr-2" />
            New Prep Recipe
          </Button>
        )}
      </div>

      {notice && (
        <div className="bg-[var(--color-success-bg)] text-[var(--color-success-text)] text-sm rounded-lg px-4 py-2.5 mb-4">
          {notice}
        </div>
      )}

      <Tabs defaultValue="menu-items">
        <TabsList className="mb-4">
          <TabsTrigger value="menu-items">
            Menu Items
            {needsAttentionCount > 0 && (
              <span className="ml-2 text-xs bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] rounded-full px-1.5 py-0.5">
                {needsAttentionCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="prep">Prep Recipes</TabsTrigger>
        </TabsList>

        <TabsContent value="menu-items">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Input placeholder="Search menu items..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="attention">Needs attention ({needsAttentionCount})</SelectItem>
                <SelectItem value="all">All items</SelectItem>
                <SelectItem value="unmapped">Unmapped</SelectItem>
                <SelectItem value="mapped">Mapped</SelectItem>
                <SelectItem value="non_recipe">Non-recipe</SelectItem>
              </SelectContent>
            </Select>
            {isManager && selected.size > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-[var(--color-muted-foreground)]">{selected.size} selected</span>
                <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkSetStatus("NON_RECIPE")}>
                  Mark non-recipe
                </Button>
                <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkSetStatus("UNMAPPED")}>
                  Mark unmapped
                </Button>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
              <p className="text-sm mb-1">No sales items yet.</p>
              <p className="text-xs">Sync your Square catalog in Sales Items first — recipes attach to synced variations.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
              <p className="text-sm">
                {statusFilter === "attention" ? "Nothing needs attention — every priced item is mapped or marked non-recipe. 🎉" : "No items match your filters."}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([group, groupItems]) => (
                <div key={group} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-accent)]/30">
                    <h2 className="text-sm font-semibold text-[var(--color-foreground)]">{group}</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border)]">
                          {isManager && <th className="w-10 px-4 py-2" />}
                          {["Item", "Price", "Recipe Cost", "Cost %", "Status"].map((h) => (
                            <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {groupItems.map((item) => (
                          <tr
                            key={item.id}
                            className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors cursor-pointer"
                            onClick={() => openItem(item)}
                          >
                            {isManager && (
                              <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                {!item.recipeId && (
                                  <Checkbox
                                    checked={selected.has(item.id)}
                                    onCheckedChange={() => toggle(item.id)}
                                    aria-label={`Select ${item.displayName}`}
                                  />
                                )}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">{item.displayName}</td>
                            <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">{price(item.priceCents)}</td>
                            <td className="px-4 py-2.5 text-sm">
                              {item.costError ? (
                                <span className="inline-flex items-center gap-1 text-[var(--color-warning-text)]" title={item.costError}>
                                  <AlertTriangle className="h-3.5 w-3.5" /> N/A
                                </span>
                              ) : (
                                <span className="text-[var(--color-foreground)]">{item.recipeId ? usd(item.cost) : "—"}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">{pct(item.costPct)}</td>
                            <td className="px-4 py-2.5"><StatusBadge status={item.recipeStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
          {isManager && selectableIds.length > 0 && selected.size === 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
              Tip: use the checkboxes to bulk-mark modifier junk, $0 rows and one-off POS buttons as non-recipe.
            </p>
          )}
        </TabsContent>

        <TabsContent value="prep">
          {prepRecipes.length === 0 ? (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
              <p className="text-sm mb-1">No prep recipes yet.</p>
              <p className="text-xs">Prep recipes (like a Cup Kit or a batch sauce) are reusable inside menu-item recipes — create one with &ldquo;New Prep Recipe&rdquo;.</p>
            </div>
          ) : (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      {["Prep Recipe", "Yield", "Batch Cost", "Cost / Unit", "Used In", "Countable", ""].map((h) => (
                        <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prepRecipes.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors cursor-pointer"
                        onClick={() => router.push(`/inventory/recipes/${r.id}`)}
                      >
                        <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">{r.name}</td>
                        <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">{r.yieldQty} {r.yieldUnit}</td>
                        <td className="px-4 py-2.5 text-sm">
                          {r.costError ? (
                            <span className="inline-flex items-center gap-1 text-[var(--color-warning-text)]" title={r.costError}>
                              <AlertTriangle className="h-3.5 w-3.5" /> N/A
                            </span>
                          ) : (
                            <span className="text-[var(--color-foreground)]">{usd(r.cost)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">
                          {r.costPerYieldUnit === null ? "—" : `${usd(r.costPerYieldUnit)} / ${r.yieldUnit}`}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[var(--color-foreground)]">
                          {r.usedInCount > 0 ? `${r.usedInCount} recipe${r.usedInCount === 1 ? "" : "s"}` : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.countable ? (
                            <Badge className="bg-[var(--color-info-bg)] text-[var(--color-info-text)] border-transparent">Countable</Badge>
                          ) : (
                            <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {r.countable && stores.length > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setPrepDialogRecipe(r)}>
                              <CookingPot className="h-3.5 w-3.5 mr-1.5" />
                              Record Prep
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <RecordPrepDialog
        recipe={prepDialogRecipe}
        stores={stores}
        onClose={() => setPrepDialogRecipe(null)}
        onRecorded={(msg) => {
          setPrepDialogRecipe(null)
          setNotice(msg)
          router.refresh()
          setTimeout(() => setNotice(null), 4000)
        }}
      />
    </div>
  )
}

// Shared with the adjustments page ("re-record" pre-fills a past batch).
export function RecordPrepDialog({
  recipe,
  stores,
  initialStoreId,
  initialMultiplier,
  onClose,
  onRecorded,
}: {
  recipe: { id: string; name: string; yieldQty: number; yieldUnit: string } | null
  stores: { id: string; name: string }[]
  initialStoreId?: string
  initialMultiplier?: number
  onClose: () => void
  onRecorded: (message: string) => void
}) {
  const [storeId, setStoreId] = useState(initialStoreId ?? (stores.length === 1 ? stores[0].id : ""))
  const [multiplier, setMultiplier] = useState(initialMultiplier?.toString() ?? "1")
  const [occurredAt, setOccurredAt] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mult = Number(multiplier) || 0

  async function save() {
    if (!recipe) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/inventory/adjustments/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeId: recipe.id,
          storeId,
          multiplier: mult,
          ...(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}),
          note: note || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to record prep")
        return
      }
      onRecorded(`Recorded ${mult}× ${recipe.name} — ingredients deducted, ${recipe.yieldQty * mult} ${recipe.yieldUnit} added.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!recipe} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Prep — {recipe?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
            <Label>Batch size</Label>
            <div className="flex items-center gap-2 mt-1">
              {["0.5", "1", "2"].map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={multiplier === m ? "default" : "outline"}
                  onClick={() => setMultiplier(m)}
                >
                  {m === "0.5" ? "½×" : `${m}×`}
                </Button>
              ))}
              <Input
                type="number"
                step="any"
                min="0"
                className="w-24 h-8"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
              />
            </div>
            {recipe && mult > 0 && (
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1.5">
                Produces {recipe.yieldQty * mult} {recipe.yieldUnit} and deducts the recipe&apos;s ingredients × {mult}.
              </p>
            )}
          </div>
          <div>
            <Label>When (leave blank for now)</Label>
            <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. morning batch" />
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!storeId || mult <= 0 || saving}>
              {saving ? "Recording..." : "Record Prep"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
