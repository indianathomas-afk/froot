"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, Copy, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { compatibleUnits, convert } from "@/lib/units"

type IngredientOption = {
  id: string
  displayName: string
  categoryName: string | null
  reportingUnit: string
  costPerReportingUnit: number
  isPrepared: boolean
}

type SubRecipeOption = {
  id: string
  name: string
  isPrep: boolean
  yieldQty: number
  yieldUnit: string
  servingSizeQty: number | null
  servingSizeUnit: string | null
  costPerYieldUnit: number | null
}

type SalesItemOption = { id: string; displayName: string; menuGroup: string | null; priceCents: number | null }

type EditorLine = {
  ingredientId: string | null
  subRecipeId: string | null
  amount: string
  unit: string
}

type RecipeProp = {
  id: string
  name: string
  salesItem: SalesItemOption | null
  yieldQty: number
  yieldUnit: string
  servingSizeQty: number | null
  servingSizeUnit: string | null
  isActive: boolean
  countable: boolean
  lines: { ingredientId: string | null; subRecipeId: string | null; amount: number; unit: string }[]
}

const usd = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" })

const UNATTACHED = "__none__"

export function RecipeEditorClient({
  isManager,
  recipe,
  prefillSalesItem,
  ingredients,
  subRecipes,
  attachableSalesItems,
  usedIn,
}: {
  isManager: boolean
  recipe: RecipeProp | null
  prefillSalesItem: SalesItemOption | null
  ingredients: IngredientOption[]
  subRecipes: SubRecipeOption[]
  attachableSalesItems: SalesItemOption[]
  usedIn: { id: string; name: string }[]
}) {
  const router = useRouter()
  const isNew = recipe === null
  const initialSalesItem = recipe?.salesItem ?? prefillSalesItem

  const [name, setName] = useState(recipe?.name ?? prefillSalesItem?.displayName ?? "")
  const [salesItemId, setSalesItemId] = useState<string>(initialSalesItem?.id ?? UNATTACHED)
  const [yieldQty, setYieldQty] = useState(String(recipe?.yieldQty ?? 1))
  const [yieldUnit, setYieldUnit] = useState(recipe?.yieldUnit ?? "serving")
  const [servingSizeQty, setServingSizeQty] = useState(recipe?.servingSizeQty?.toString() ?? "")
  const [servingSizeUnit, setServingSizeUnit] = useState(recipe?.servingSizeUnit ?? "")
  const [countable, setCountable] = useState(recipe?.countable ?? false)
  const [lines, setLines] = useState<EditorLine[]>(
    recipe?.lines.map((l) => ({
      ingredientId: l.ingredientId,
      subRecipeId: l.subRecipeId,
      amount: String(l.amount),
      unit: l.unit,
    })) ?? []
  )
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loopLinks, setLoopLinks] = useState<{ id: string; name: string }[]>([])
  const [lineErrors, setLineErrors] = useState<Map<number, string>>(new Map())
  const [toast, setToast] = useState<string | null>(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients])
  const subRecipeById = useMemo(() => new Map(subRecipes.map((r) => [r.id, r])), [subRecipes])

  const attachedItem =
    salesItemId === UNATTACHED
      ? null
      : initialSalesItem?.id === salesItemId
        ? initialSalesItem
        : attachableSalesItems.find((s) => s.id === salesItemId) ?? null

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return { ingredients: [], subRecipes: [] }
    return {
      ingredients: ingredients.filter((i) => i.displayName.toLowerCase().includes(q)).slice(0, 6),
      subRecipes: subRecipes.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 4),
    }
  }, [search, ingredients, subRecipes])

  // Live line costs — mirrors the server engine using the costs shipped with
  // the page (sub-recipe unit costs are snapshots; their own lines aren't
  // being edited here).
  const lineCosts: (number | null)[] = lines.map((line) => {
    const amount = Number(line.amount)
    if (!Number.isFinite(amount) || amount <= 0) return null
    if (line.ingredientId) {
      const ing = ingredientById.get(line.ingredientId)
      if (!ing) return null
      const qty = convert(amount, line.unit, ing.reportingUnit)
      if (qty === null) return null
      return qty * ing.costPerReportingUnit
    }
    if (line.subRecipeId) {
      const sub = subRecipeById.get(line.subRecipeId)
      if (!sub || sub.costPerYieldUnit === null) return null
      const qty = convert(amount, line.unit, sub.yieldUnit)
      if (qty === null) return null
      return qty * sub.costPerYieldUnit
    }
    return null
  })
  const totalCost = lineCosts.every((c) => c !== null) && lines.length > 0
    ? (lineCosts as number[]).reduce((s, c) => s + c, 0)
    : null
  const liveCostPct =
    totalCost !== null && attachedItem?.priceCents ? totalCost / (attachedItem.priceCents / 100) : null

  function addIngredientLine(ing: IngredientOption) {
    setLines((prev) => [...prev, { ingredientId: ing.id, subRecipeId: null, amount: "1", unit: ing.reportingUnit }])
    setSearch("")
  }

  function addSubRecipeLine(sub: SubRecipeOption) {
    // Sub-recipe lines pre-fill from the sub-recipe's serving size.
    setLines((prev) => [
      ...prev,
      {
        ingredientId: null,
        subRecipeId: sub.id,
        amount: String(sub.servingSizeQty ?? 1),
        unit: sub.servingSizeUnit ?? sub.yieldUnit,
      },
    ])
    setSearch("")
  }

  function updateLine(index: number, patch: Partial<EditorLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function lineLabel(line: EditorLine): { name: string; detail: string | null } {
    if (line.ingredientId) {
      const ing = ingredientById.get(line.ingredientId)
      return {
        name: ing?.displayName ?? "Missing ingredient",
        detail: ing ? `${usd(ing.costPerReportingUnit)} / ${ing.reportingUnit}${ing.isPrepared ? " · prepared" : ""}` : null,
      }
    }
    const sub = line.subRecipeId ? subRecipeById.get(line.subRecipeId) : null
    return {
      name: sub?.name ?? "Missing sub-recipe",
      detail: sub
        ? `sub-recipe · ${sub.costPerYieldUnit === null ? "cost N/A" : `${usd(sub.costPerYieldUnit)} / ${sub.yieldUnit}`}`
        : null,
    }
  }

  function unitOptionsFor(line: EditorLine): string[] {
    if (line.ingredientId) {
      const ing = ingredientById.get(line.ingredientId)
      return ing ? compatibleUnits(ing.reportingUnit) : [line.unit]
    }
    const sub = line.subRecipeId ? subRecipeById.get(line.subRecipeId) : null
    return sub ? compatibleUnits(sub.yieldUnit) : [line.unit]
  }

  async function save() {
    setSaving(true)
    setError(null)
    setLoopLinks([])
    setLineErrors(new Map())
    try {
      const payload = {
        name,
        salesItemId: salesItemId === UNATTACHED ? null : salesItemId,
        yieldQty: Number(yieldQty) || 1,
        yieldUnit,
        servingSizeQty: servingSizeQty ? Number(servingSizeQty) : null,
        servingSizeUnit: servingSizeUnit || null,
        lines: lines.map((l) => ({
          ingredientId: l.ingredientId,
          subRecipeId: l.subRecipeId,
          amount: Number(l.amount) || 0,
          unit: l.unit,
        })),
        ...(salesItemId === UNATTACHED ? { countable } : {}),
      }
      const res = await fetch(isNew ? "/api/inventory/recipes" : `/api/inventory/recipes/${recipe!.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to save recipe")
        if (data.loopRecipeIds) {
          setLoopLinks(
            (data.loopRecipeIds as string[])
              .filter((rid) => rid !== (recipe?.id ?? "__candidate__"))
              .map((rid) => ({ id: rid, name: subRecipeById.get(rid)?.name ?? "View recipe" }))
          )
        }
        if (data.lineErrors) {
          setLineErrors(new Map((data.lineErrors as { index: number; error: string }[]).map((e) => [e.index, e.error])))
        }
        return
      }
      if (isNew) {
        router.push(`/inventory/recipes/${data.id}`)
        return
      }
      const n = data.affectedRecipeCount ?? 0
      setToast(n > 0 ? `Saved. Costs updated for ${n} recipe${n === 1 ? "" : "s"} that use this one.` : "Saved.")
      setTimeout(() => setToast(null), 5000)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/inventory/recipes/${recipe!.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? "Failed to delete recipe")
      return
    }
    router.push("/inventory/recipes")
  }

  const canSave =
    isManager &&
    name.trim().length > 0 &&
    lines.length > 0 &&
    lines.every((l) => Number(l.amount) > 0) &&
    Number(yieldQty) > 0

  return (
    <div className="max-w-4xl">
      <Link
        href="/inventory/recipes"
        className="inline-flex items-center text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to recipes
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
            {isNew ? "New Recipe" : recipe!.name}
          </h1>
          {attachedItem && (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              Costs &ldquo;{attachedItem.displayName}&rdquo;
              {attachedItem.priceCents !== null && <> · sells at {usd(attachedItem.priceCents / 100)}</>}
            </p>
          )}
        </div>
        {!isNew && isManager && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicate to variation
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5 text-[var(--color-destructive)]" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {recipe!.salesItem
                      ? `"${recipe!.salesItem.displayName}" goes back to the unmapped queue.`
                      : "This prep recipe will be permanently removed."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {toast && (
        <div className="bg-[var(--color-success-bg)] text-[var(--color-success-text)] text-sm rounded-lg px-4 py-2.5 mb-4">
          {toast}
        </div>
      )}
      {error && (
        <div className="bg-[var(--color-destructive)]/10 border border-[var(--color-destructive)]/30 text-sm rounded-lg px-4 py-3 mb-4">
          <p className="flex items-center gap-2 text-[var(--color-destructive)] font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </p>
          {loopLinks.length > 0 && (
            <p className="mt-1.5 text-[var(--color-muted-foreground)]">
              Recipes in the loop:{" "}
              {loopLinks.map((l, i) => (
                <span key={`${l.id}-${i}`}>
                  {i > 0 && " · "}
                  <Link href={`/inventory/recipes/${l.id}`} className="underline hover:text-[var(--color-foreground)]">
                    {l.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Recipe name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. All That Razz (L)" disabled={!isManager} />
          </div>
          <div>
            <Label>Attached sales item</Label>
            <Select value={salesItemId} onValueChange={setSalesItemId} disabled={!isManager}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNATTACHED}>None — sub-recipe / batch</SelectItem>
                {initialSalesItem && <SelectItem value={initialSalesItem.id}>{initialSalesItem.displayName}</SelectItem>}
                {attachableSalesItems
                  .filter((s) => s.id !== initialSalesItem?.id)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.displayName}{s.menuGroup ? ` — ${s.menuGroup}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Yield</Label>
            <div className="flex items-center gap-2">
              <Input type="number" step="any" min="0" className="w-24" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} disabled={!isManager} />
              <Input className="w-32" value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} placeholder="serving" disabled={!isManager} />
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">How much one batch makes (e.g. 1 serving, 32 each).</p>
          </div>
          {salesItemId === UNATTACHED && (
            <>
              <div>
                <Label>Typical amount used per recipe (optional)</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" step="any" min="0" className="w-24" value={servingSizeQty} onChange={(e) => setServingSizeQty(e.target.value)} disabled={!isManager} />
                  <Input className="w-32" value={servingSizeUnit} onChange={(e) => setServingSizeUnit(e.target.value)} placeholder={yieldUnit} disabled={!isManager} />
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Pre-fills the amount when this is added as a line in another recipe.</p>
              </div>
              <div>
                <Label>Countable prep item</Label>
                <div className="flex items-center gap-2 mt-2">
                  <Switch checked={countable} onCheckedChange={setCountable} disabled={!isManager} />
                  <span className="text-sm text-[var(--color-muted-foreground)]">
                    Track on-hand — creates a prepared ingredient countable in storage areas
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 mb-6">
        <Label>Add ingredient or sub-recipe</Label>
        <div className="relative">
          <Input
            placeholder="Search ingredients and sub-recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!isManager}
          />
          {(searchResults.ingredients.length > 0 || searchResults.subRecipes.length > 0) && (
            <div className="absolute z-10 mt-1 w-full bg-[var(--color-popover)] border border-[var(--color-border)] rounded-md shadow-md max-h-72 overflow-y-auto">
              {searchResults.subRecipes.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => addSubRecipeLine(sub)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent)] transition-colors"
                >
                  <span className="font-medium text-[var(--color-foreground)]">{sub.name}</span>
                  <Badge variant="secondary" className="ml-2 text-[10px]">{sub.isPrep ? "sub-recipe" : "recipe"}</Badge>
                  <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
                    {sub.costPerYieldUnit === null ? "cost N/A" : `${usd(sub.costPerYieldUnit)} / ${sub.yieldUnit}`}
                  </span>
                </button>
              ))}
              {searchResults.ingredients.map((ing) => (
                <button
                  key={ing.id}
                  onClick={() => addIngredientLine(ing)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent)] transition-colors"
                >
                  <span className="font-medium text-[var(--color-foreground)]">{ing.displayName}</span>
                  {ing.isPrepared && <Badge variant="secondary" className="ml-2 text-[10px]">prepared</Badge>}
                  <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
                    {ing.categoryName ? `${ing.categoryName} · ` : ""}{usd(ing.costPerReportingUnit)} / {ing.reportingUnit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <table className="w-full mt-4">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Line", "Amount", "Unit", "Cost", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const label = lineLabel(line)
                const lineError = lineErrors.get(i)
                return (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-2">
                      <p className="text-sm text-[var(--color-foreground)]">{label.name}</p>
                      {label.detail && <p className="text-xs text-[var(--color-muted-foreground)]">{label.detail}</p>}
                      {lineError && <p className="text-xs text-[var(--color-destructive)]">{lineError}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        className="h-8 w-24 text-sm"
                        value={line.amount}
                        onChange={(e) => updateLine(i, { amount: e.target.value })}
                        disabled={!isManager}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select value={line.unit} onValueChange={(unit) => updateLine(i, { unit })} disabled={!isManager}>
                        <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {unitOptionsFor(line).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-sm text-[var(--color-foreground)] whitespace-nowrap">
                      {lineCosts[i] === null ? <span className="text-[var(--color-muted-foreground)]">—</span> : usd(lineCosts[i])}
                    </td>
                    <td className="px-3 py-2">
                      {isManager && (
                        <button onClick={() => removeLine(i)} className="p-1 rounded hover:bg-[var(--color-accent)]">
                          <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border)]">
          <div className="text-sm text-[var(--color-muted-foreground)]">
            {usedIn.length > 0 && (
              <span>
                Used in {usedIn.length} recipe{usedIn.length === 1 ? "" : "s"}:{" "}
                {usedIn.slice(0, 5).map((u, i) => (
                  <span key={u.id}>
                    {i > 0 && ", "}
                    <Link href={`/inventory/recipes/${u.id}`} className="underline hover:text-[var(--color-foreground)]">{u.name}</Link>
                  </span>
                ))}
                {usedIn.length > 5 && ` +${usedIn.length - 5} more`}
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-[var(--color-foreground)]">
              Total: {totalCost === null ? "N/A" : usd(totalCost)}
            </p>
            {liveCostPct !== null && (
              <p className="text-sm text-[var(--color-muted-foreground)]">Cost: {(liveCostPct * 100).toFixed(1)}% of price</p>
            )}
          </div>
        </div>
      </div>

      {isManager && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? "Saving..." : isNew ? "Create Recipe" : "Save Recipe"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/inventory/recipes")}>Cancel</Button>
        </div>
      )}

      <DuplicateDialog
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        recipeId={recipe?.id ?? null}
        targets={attachableSalesItems}
        onDuplicated={(newId) => router.push(`/inventory/recipes/${newId}`)}
      />
    </div>
  )
}

function DuplicateDialog({
  open,
  onClose,
  recipeId,
  targets,
  onDuplicated,
}: {
  open: boolean
  onClose: () => void
  recipeId: string | null
  targets: SalesItemOption[]
  onDuplicated: (newRecipeId: string) => void
}) {
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? targets.filter((t) => t.displayName.toLowerCase().includes(q)) : targets).slice(0, 12)
  }, [search, targets])

  async function duplicate(salesItemId: string) {
    if (!recipeId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/recipes/${recipeId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesItemId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to duplicate")
        return
      }
      onDuplicated(data.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate to another variation</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Copies this recipe onto an unmapped sales item — build the Large once, then tweak amounts on the copy.
        </p>
        <Input placeholder="Search unmapped items..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        <div className="max-h-64 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)] py-4 text-center">No unmapped sales items.</p>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => duplicate(t.id)}
                className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-[var(--color-accent)] transition-colors"
              >
                <span className="text-[var(--color-foreground)]">{t.displayName}</span>
                <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
                  {t.menuGroup ?? ""}{t.priceCents !== null ? ` · ${usd(t.priceCents / 100)}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
