"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ALL_UNITS } from "@/lib/units"
import { CategoryManagerDialog } from "./category-manager-dialog"
import { CsvImportButton } from "./csv-import-button"

type Category = { id: string; name: string; glCode: string | null }

type Ingredient = {
  id: string
  brand: string | null
  name: string
  categoryId: string | null
  categoryName: string | null
  purchaseUnitLabel: string
  packDescription: string | null
  purchaseCost: number
  reportingUnit: string
  unitsPerPurchase: number
  costPerReportingUnit: number
  isActive: boolean
  notes: string | null
}

const emptyForm = {
  brand: "",
  name: "",
  categoryId: "",
  purchaseUnitLabel: "",
  packDescription: "",
  purchaseCost: "",
  reportingUnit: "",
  unitsPerPurchase: "",
  notes: "",
}

export function IngredientsClient({
  ingredients,
  categories,
  canManage,
  isAdmin,
}: {
  ingredients: Ingredient[]
  categories: Category[]
  canManage: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [showInactive, setShowInactive] = useState(false)
  const [dialogIngredient, setDialogIngredient] = useState<Ingredient | null | undefined>(undefined)
  const [managingCategories, setManagingCategories] = useState(false)

  const filtered = useMemo(() => {
    return ingredients.filter((i) => {
      if (!showInactive && !i.isActive) return false
      if (categoryFilter !== "all" && i.categoryId !== categoryFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (!i.name.toLowerCase().includes(q) && !i.brand?.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [ingredients, search, categoryFilter, showInactive])

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Ingredients</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            What you buy and count — vendors, pack sizes, and unit costs. Not synced from Square.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setManagingCategories(true)}>
              <Settings2 className="h-4 w-4" />
              Categories
            </Button>
            {isAdmin && <CsvImportButton onImported={() => router.refresh()} />}
            <Button onClick={() => setDialogIngredient(null)}>
              <Plus className="h-4 w-4" />
              New Ingredient
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Input placeholder="Search ingredients..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive
        </label>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {ingredients.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm mb-1">No ingredients yet.</p>
            <p className="text-xs">Ingredients aren&apos;t synced from Square — add them here, or import a CSV.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No ingredients match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["Ingredient", "Category", "GL Code", "Pack", "Purchase Cost", "Cost / Unit", ""].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((ing) => {
                  const category = categories.find((c) => c.id === ing.categoryId)
                  return (
                    <tr key={ing.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-[var(--color-foreground)]">
                          {ing.brand ? `${ing.brand} ` : ""}{ing.name}
                        </p>
                        {!ing.isActive && <Badge variant="secondary" className="mt-1">Inactive</Badge>}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{ing.categoryName ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{category?.glCode ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                        {ing.purchaseUnitLabel}{ing.packDescription ? ` (${ing.packDescription})` : ""}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">${ing.purchaseCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-foreground)]">
                        ${ing.costPerReportingUnit.toFixed(4)}/{ing.reportingUnit}
                      </td>
                      <td className="px-4 py-3">
                        {canManage && (
                          <button onClick={() => setDialogIngredient(ing)} className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors">
                            <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <IngredientDialog
        ingredient={dialogIngredient}
        categories={categories}
        onClose={() => setDialogIngredient(undefined)}
        onSaved={() => {
          setDialogIngredient(undefined)
          router.refresh()
        }}
      />

      <CategoryManagerDialog
        open={managingCategories}
        categories={categories}
        onClose={() => setManagingCategories(false)}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}

function IngredientDialog({
  ingredient,
  categories,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient | null | undefined
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const isOpen = ingredient !== undefined
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastId, setLastId] = useState<string | null | undefined>(undefined)

  if (isOpen && ingredient?.id !== lastId) {
    setLastId(ingredient?.id ?? null)
    setForm(
      ingredient
        ? {
            brand: ingredient.brand ?? "",
            name: ingredient.name,
            categoryId: ingredient.categoryId ?? "",
            purchaseUnitLabel: ingredient.purchaseUnitLabel,
            packDescription: ingredient.packDescription ?? "",
            purchaseCost: ingredient.purchaseCost.toString(),
            reportingUnit: ingredient.reportingUnit,
            unitsPerPurchase: ingredient.unitsPerPurchase.toString(),
            notes: ingredient.notes ?? "",
          }
        : emptyForm
    )
    setError(null)
  }

  const costPreview =
    Number(form.purchaseCost) > 0 && Number(form.unitsPerPurchase) > 0
      ? Number(form.purchaseCost) / Number(form.unitsPerPurchase)
      : null

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        brand: form.brand || null,
        name: form.name,
        categoryId: form.categoryId || null,
        purchaseUnitLabel: form.purchaseUnitLabel,
        packDescription: form.packDescription || null,
        purchaseCost: Number(form.purchaseCost),
        reportingUnit: form.reportingUnit,
        unitsPerPurchase: Number(form.unitsPerPurchase),
        notes: form.notes || null,
      }
      const res = await fetch(ingredient ? `/api/inventory/ingredients/${ingredient.id}` : "/api/inventory/ingredients", {
        method: ingredient ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Save failed")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const canSave = form.name.trim() && form.purchaseUnitLabel.trim() && form.reportingUnit && Number(form.purchaseCost) >= 0 && Number(form.unitsPerPurchase) > 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ingredient ? "Edit Ingredient" : "New Ingredient"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Brand (optional)</Label>
              <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.categoryId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="No category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.glCode ? ` (${c.glCode})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Purchase Unit</Label>
              <Input placeholder="box, case, bag..." value={form.purchaseUnitLabel} onChange={(e) => setForm((f) => ({ ...f, purchaseUnitLabel: e.target.value }))} />
            </div>
            <div>
              <Label>Pack Description (optional)</Label>
              <Input placeholder="40 lbs, 2 x 36 fl. oz..." value={form.packDescription} onChange={(e) => setForm((f) => ({ ...f, packDescription: e.target.value }))} />
            </div>
            <div>
              <Label>Purchase Cost ($)</Label>
              <Input type="number" value={form.purchaseCost} onChange={(e) => setForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
            </div>
            <div>
              <Label>Reporting Unit</Label>
              <Select value={form.reportingUnit || undefined} onValueChange={(v) => setForm((f) => ({ ...f, reportingUnit: v }))}>
                <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                <SelectContent>
                  {ALL_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Reporting Units per Purchase Unit</Label>
              <Input type="number" placeholder="e.g. 40 for a 40-lb box" value={form.unitsPerPurchase} onChange={(e) => setForm((f) => ({ ...f, unitsPerPurchase: e.target.value }))} />
            </div>
          </div>
          {costPreview !== null && form.reportingUnit && (
            <div className="text-sm bg-[var(--color-accent)]/50 rounded-md px-3 py-2 text-[var(--color-foreground)]">
              Cost per {form.reportingUnit}: <span className="font-medium">${costPreview.toFixed(4)}</span>
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
          <Button onClick={handleSave} disabled={saving || !canSave}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
