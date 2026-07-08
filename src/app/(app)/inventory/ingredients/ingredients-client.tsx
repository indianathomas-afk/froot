"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Settings2, Archive, ArchiveRestore, Trash2, StickyNote, Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ALL_UNITS } from "@/lib/units"
import { isCloseNameMatch } from "@/lib/duplicate-match"
import { CategoryManagerDialog } from "./category-manager-dialog"
import { CsvImportButton } from "./csv-import-button"
import Link from "next/link"

type Category = { id: string; name: string; glCode: string | null }
type Vendor = { id: string; name: string; isActive: boolean }
type DeletedName = { id: string; brand: string | null; name: string }
type StoreOption = { id: string; name: string }

type ParEntry = { parLevel: number | null; reorderPoint: number | null }
type ParsData = {
  storeId: string
  pars: Record<string, ParEntry>
  weeklyUsage: Record<string, number>
  usageBasis: "periods" | "sales" | "none"
}

type Ingredient = {
  id: string
  brand: string | null
  name: string
  categoryId: string | null
  categoryName: string | null
  categoryGlCode: string | null
  subcategory: string | null
  sku: string | null
  purchaseUnitLabel: string
  packDescription: string | null
  purchaseCost: number
  reportingUnit: string
  unitsPerPurchase: number
  costPerReportingUnit: number
  glCodeOverride: string | null
  effectiveGlCode: string | null
  productNote: string | null
  isActive: boolean
  isArchived: boolean
  lastEditedByUserId: string | null
  lastEditedByName: string | null
  kind: string
  notes: string | null
  vendorNames: string[]
  vendorPriceDisplay: number | null
  vendorCount: number
  createdAt: string
  updatedAt: string
}

const emptyForm = {
  brand: "",
  name: "",
  categoryId: "",
  subcategory: "",
  sku: "",
  purchaseUnitLabel: "",
  packDescription: "",
  purchaseCost: "",
  reportingUnit: "",
  unitsPerPurchase: "",
  glCodeOverride: "",
  productNote: "",
  notes: "",
}

type GroupBy = "none" | "category" | "subcategory" | "vendor" | "lastEdited"
type ViewFilter = "active" | "archived" | "all"

const URL_REGEX = /(https?:\/\/[^\s]+)/g

function linkify(text: string): ReactNode[] {
  const parts = text.split(URL_REGEX)
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-primary)] underline"
        onClick={(e) => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function IngredientsClient({
  ingredients,
  categories,
  ingredientCountByCategory,
  deletedIngredientNames,
  stores,
  canManage,
  isAdmin,
}: {
  ingredients: Ingredient[]
  categories: Category[]
  ingredientCountByCategory: Record<string, number>
  deletedIngredientNames: DeletedName[]
  stores: StoreOption[]
  canManage: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [viewFilter, setViewFilter] = useState<ViewFilter>("active")
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [dialogIngredient, setDialogIngredient] = useState<Ingredient | null | undefined>(undefined)
  const [managingCategories, setManagingCategories] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [parsStoreId, setParsStoreId] = useState(stores[0]?.id ?? "")
  const [parsData, setParsData] = useState<ParsData | null>(null)

  useEffect(() => {
    fetch("/api/inventory/vendors")
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => setVendors(v))
      .catch(() => {})
  }, [])

  // Pars + weekly usage for the selected store. The payload carries its
  // storeId so a slow response for a previously selected store never lands.
  useEffect(() => {
    if (!parsStoreId) return
    let cancelled = false
    fetch(`/api/inventory/pars?storeId=${parsStoreId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const pars: Record<string, ParEntry> = {}
        for (const p of data.pars as { ingredientId: string; parLevel: number | null; reorderPoint: number | null }[]) {
          pars[p.ingredientId] = { parLevel: p.parLevel, reorderPoint: p.reorderPoint }
        }
        setParsData({ storeId: parsStoreId, pars, weeklyUsage: data.weeklyUsage, usageBasis: data.usageBasis })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [parsStoreId])

  const parsLoaded = parsData?.storeId === parsStoreId
  const parsStoreName = stores.find((s) => s.id === parsStoreId)?.name ?? ""

  function handleParSaved(ingredientId: string, entry: ParEntry) {
    setParsData((prev) => {
      if (!prev) return prev
      const next = { ...prev, pars: { ...prev.pars } }
      if (entry.parLevel === null && entry.reorderPoint === null) delete next.pars[ingredientId]
      else next.pars[ingredientId] = entry
      return next
    })
  }

  const filtered = useMemo(() => {
    return ingredients.filter((i) => {
      if (viewFilter === "active" && i.isArchived) return false
      if (viewFilter === "archived" && !i.isArchived) return false
      if (categoryFilter !== "all" && i.categoryId !== categoryFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (
          !i.name.toLowerCase().includes(q) &&
          !i.brand?.toLowerCase().includes(q) &&
          !i.sku?.toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [ingredients, search, categoryFilter, viewFilter])

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ label: null as string | null, rows: filtered }]
    const map = new Map<string, Ingredient[]>()
    for (const i of filtered) {
      let key: string
      if (groupBy === "category") key = i.categoryName ?? "No Category"
      else if (groupBy === "subcategory") key = i.subcategory ?? "No Subcategory"
      else if (groupBy === "vendor") key = i.vendorNames[0] ?? "No Vendor"
      else key = i.lastEditedByName ?? "Unknown"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(i)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rows]) => ({ label, rows }))
  }, [filtered, groupBy])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleArchiveToggle(ingredient: Ingredient) {
    await fetch(`/api/inventory/ingredients/${ingredient.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived: !ingredient.isArchived }),
    })
    router.refresh()
  }

  async function handleDelete(ingredient: Ingredient) {
    await fetch(`/api/inventory/ingredients/${ingredient.id}`, { method: "DELETE" })
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(ingredient.id)
      return next
    })
    router.refresh()
  }

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
            <Link href="/inventory/ingredients/duplicates">
              <Button variant="outline">
                <Shuffle className="h-4 w-4" />
                Duplicates
              </Button>
            </Link>
            <Link href="/inventory/ingredients/deleted">
              <Button variant="outline">
                <Trash2 className="h-4 w-4" />
                View Deleted
              </Button>
            </Link>
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

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input placeholder="Search ingredients..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Group by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="category">Category</SelectItem>
            <SelectItem value="subcategory">Subcategory</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="lastEdited">Last Edited</SelectItem>
          </SelectContent>
        </Select>
        {stores.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-muted-foreground)]">Pars for</span>
            <Select value={parsStoreId} onValueChange={setParsStoreId}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Select store" /></SelectTrigger>
              <SelectContent>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center rounded-md border border-[var(--color-border)] overflow-hidden text-sm">
          {(["active", "archived", "all"] as ViewFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setViewFilter(v)}
              className={
                "px-3 py-1.5 capitalize transition-colors " +
                (viewFilter === v
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]")
              }
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {canManage && selectedIds.size > 0 && (
        <BulkEditPanel
          count={selectedIds.size}
          categories={categories}
          vendors={vendors}
          parsStoreName={parsStoreName}
          onVendorsChanged={(v) => setVendors((prev) => [...prev, v])}
          onCategoriesChanged={() => router.refresh()}
          onClear={() => setSelectedIds(new Set())}
          onApply={async (payload) => {
            await fetch("/api/inventory/ingredients/bulk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: [...selectedIds], ...payload }),
            })
            setSelectedIds(new Set())
            router.refresh()
          }}
          onApplyPars={async (pars) => {
            if (!parsStoreId) return
            const res = await fetch("/api/inventory/pars", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storeId: parsStoreId,
                pars: [...selectedIds].map((ingredientId) => ({ ingredientId, ...pars })),
              }),
            })
            if (res.ok) {
              setParsData((prev) => {
                if (!prev) return prev
                const next = { ...prev, pars: { ...prev.pars } }
                for (const id of selectedIds) {
                  const merged: ParEntry = {
                    parLevel: pars.parLevel !== undefined ? pars.parLevel : next.pars[id]?.parLevel ?? null,
                    reorderPoint:
                      pars.reorderPoint !== undefined ? pars.reorderPoint : next.pars[id]?.reorderPoint ?? null,
                  }
                  if (merged.parLevel === null && merged.reorderPoint === null) delete next.pars[id]
                  else next.pars[id] = merged
                }
                return next
              })
            }
            setSelectedIds(new Set())
          }}
        />
      )}

      {parsStoreId && parsLoaded && (
        <p className="text-xs text-[var(--color-muted-foreground)] mb-3">
          {parsData?.usageBasis === "periods"
            ? "Weekly usage is real count-to-count usage from your inventory periods."
            : parsData?.usageBasis === "sales"
              ? "Weekly usage is estimated from synced sales (no full inventory period yet)."
              : "No usage data yet — finalize two full counts or sync sales to see weekly usage."}{" "}
          Unsure of pars? Order to usage for a few weeks to discover them.
        </p>
      )}

      {ingredients.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
          <p className="text-sm mb-1">No ingredients yet.</p>
          <p className="text-xs">Ingredients aren&apos;t synced from Square — add them here, or import a CSV.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center text-[var(--color-muted-foreground)]">
          <p className="text-sm">No ingredients match your filters.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label ?? "all"}>
              {group.label !== null && (
                <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-2">
                  {group.label} <span className="text-[var(--color-muted-foreground)] font-normal">({group.rows.length})</span>
                </h2>
              )}
              <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        {canManage && (
                          <th className="px-4 py-3 w-8">
                            <Checkbox
                              checked={group.rows.length > 0 && group.rows.every((r) => selectedIds.has(r.id))}
                              onCheckedChange={() => {
                                const rowIds = group.rows.map((r) => r.id)
                                const allChecked = rowIds.every((id) => selectedIds.has(id))
                                setSelectedIds((prev) => {
                                  const next = new Set(prev)
                                  if (allChecked) rowIds.forEach((id) => next.delete(id))
                                  else rowIds.forEach((id) => next.add(id))
                                  return next
                                })
                              }}
                            />
                          </th>
                        )}
                        {[
                          "Ingredient",
                          "Category",
                          "Pack",
                          "Vendor Price",
                          "Cost / Unit",
                          ...(parsStoreId ? ["Par / Reorder", "Usage / wk"] : []),
                          "Last Edited",
                          "",
                        ].map((h) => (
                          <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((ing) => (
                        <tr key={ing.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                          {canManage && (
                            <td className="px-4 py-3">
                              <Checkbox checked={selectedIds.has(ing.id)} onCheckedChange={() => toggleSelect(ing.id)} />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-[var(--color-foreground)]">
                                {ing.brand ? `${ing.brand} ` : ""}{ing.name}
                              </p>
                              {ing.productNote && <NotePopover note={ing.productNote} />}
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                              {ing.isArchived && <Badge variant="secondary">Archived</Badge>}
                              {ing.sku && <span className="text-xs text-[var(--color-muted-foreground)]">SKU {ing.sku}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                            {ing.categoryName ?? "—"}
                            {ing.effectiveGlCode && (
                              <span className="ml-1.5 text-xs">
                                · GL {ing.effectiveGlCode}
                                {ing.glCodeOverride && <span className="text-[var(--color-warning-text)]"> (override)</span>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                            {ing.purchaseUnitLabel}{ing.packDescription ? ` (${ing.packDescription})` : ""}
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                            {ing.vendorCount === 0
                              ? "—"
                              : `$${ing.vendorPriceDisplay?.toFixed(4)}${ing.vendorCount > 1 ? ` (${ing.vendorCount} vendors)` : ""}`}
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-foreground)]">
                            ${ing.costPerReportingUnit.toFixed(4)}/{ing.reportingUnit}
                          </td>
                          {parsStoreId && (
                            <>
                              <td className="px-4 py-3">
                                {parsLoaded ? (
                                  <ParCell
                                    key={`${parsStoreId}-${ing.id}`}
                                    storeId={parsStoreId}
                                    ingredientId={ing.id}
                                    reportingUnit={ing.reportingUnit}
                                    purchaseUnitLabel={ing.purchaseUnitLabel}
                                    unitsPerPurchase={ing.unitsPerPurchase}
                                    entry={parsData?.pars[ing.id] ?? null}
                                    canManage={canManage}
                                    onSaved={handleParSaved}
                                  />
                                ) : (
                                  <span className="text-xs text-[var(--color-muted-foreground)]">…</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)] whitespace-nowrap">
                                {parsLoaded && parsData?.weeklyUsage[ing.id] !== undefined ? (
                                  <>
                                    {(Math.round(parsData.weeklyUsage[ing.id] * 10) / 10).toLocaleString()} {ing.reportingUnit}
                                    {parsData.usageBasis === "sales" && (
                                      <span className="block text-xs opacity-70">from sales</span>
                                    )}
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                            {formatDate(ing.updatedAt)}
                            {ing.lastEditedByName && <div>{ing.lastEditedByName}</div>}
                          </td>
                          <td className="px-4 py-3">
                            {canManage && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => setDialogIngredient(ing)} className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors" title="Edit">
                                  <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                                </button>
                                <button onClick={() => handleArchiveToggle(ing)} className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors" title={ing.isArchived ? "Unarchive" : "Archive"}>
                                  {ing.isArchived ? (
                                    <ArchiveRestore className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                                  ) : (
                                    <Archive className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                                  )}
                                </button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <button className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors" title="Delete">
                                      <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
                                    </button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete {ing.name}?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This moves the ingredient to View Deleted, where it can be restored later. It won&apos;t
                                        appear in counts, POs, or recipes while deleted.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDelete(ing)}
                                        className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <IngredientDialog
        ingredient={dialogIngredient}
        categories={categories}
        archivedAndDeletedNames={[
          ...ingredients.filter((i) => i.isArchived).map((i) => ({ id: i.id, brand: i.brand, name: i.name })),
          ...deletedIngredientNames,
        ]}
        onClose={() => setDialogIngredient(undefined)}
        onSaved={() => {
          setDialogIngredient(undefined)
          router.refresh()
        }}
      />

      <CategoryManagerDialog
        open={managingCategories}
        categories={categories}
        ingredientCountByCategory={ingredientCountByCategory}
        onClose={() => setManagingCategories(false)}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}

function NotePopover({ note }: { note: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="p-0.5 rounded hover:bg-[var(--color-accent)]"
        title="Product note"
      >
        <StickyNote className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-64 p-3 bg-[var(--color-popover)] border border-[var(--color-border)] rounded-md shadow-md text-xs text-[var(--color-foreground)] whitespace-pre-wrap break-words">
            {linkify(note)}
          </div>
        </>
      )}
    </div>
  )
}

// Par + reorder point for one ingredient at the selected store, in the
// ingredient's reporting unit. Saves on blur; shows the purchase-unit
// equivalent of the par so "12 lbs" reads as "≈ 0.3 box".
function ParCell({
  storeId,
  ingredientId,
  reportingUnit,
  purchaseUnitLabel,
  unitsPerPurchase,
  entry,
  canManage,
  onSaved,
}: {
  storeId: string
  ingredientId: string
  reportingUnit: string
  purchaseUnitLabel: string
  unitsPerPurchase: number
  entry: ParEntry | null
  canManage: boolean
  onSaved: (ingredientId: string, entry: ParEntry) => void
}) {
  const [parVal, setParVal] = useState(entry?.parLevel?.toString() ?? "")
  const [reorderVal, setReorderVal] = useState(entry?.reorderPoint?.toString() ?? "")
  const [saving, setSaving] = useState(false)

  if (!canManage) {
    if (!entry) return <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
    return (
      <span className="text-sm text-[var(--color-foreground)] whitespace-nowrap">
        {entry.parLevel ?? "—"} / {entry.reorderPoint ?? "—"} {reportingUnit}
      </span>
    )
  }

  async function save() {
    const parse = (v: string) => {
      if (v.trim() === "") return null
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : undefined // undefined = invalid
    }
    const parLevel = parse(parVal)
    const reorderPoint = parse(reorderVal)
    if (parLevel === undefined || reorderPoint === undefined) return
    if (parLevel === (entry?.parLevel ?? null) && reorderPoint === (entry?.reorderPoint ?? null)) return
    setSaving(true)
    try {
      const res = await fetch("/api/inventory/pars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, pars: [{ ingredientId, parLevel, reorderPoint }] }),
      })
      if (res.ok) onSaved(ingredientId, { parLevel, reorderPoint })
    } finally {
      setSaving(false)
    }
  }

  const parNum = Number(parVal)
  const caseEquivalent =
    parVal.trim() !== "" && Number.isFinite(parNum) && parNum > 0 && unitsPerPurchase > 0
      ? parNum / unitsPerPurchase
      : null

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          placeholder="Par"
          title={`Par level (${reportingUnit})`}
          value={parVal}
          onChange={(e) => setParVal(e.target.value)}
          onBlur={save}
          disabled={saving}
          className="h-8 w-20 text-sm"
        />
        <Input
          type="number"
          min={0}
          placeholder="Reorder"
          title={`Reorder point (${reportingUnit})`}
          value={reorderVal}
          onChange={(e) => setReorderVal(e.target.value)}
          onBlur={save}
          disabled={saving}
          className="h-8 w-20 text-sm"
        />
        <span className="text-xs text-[var(--color-muted-foreground)]">{reportingUnit}</span>
      </div>
      {caseEquivalent !== null && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
          ≈ {(Math.round(caseEquivalent * 10) / 10).toLocaleString()} {purchaseUnitLabel}
        </p>
      )}
    </div>
  )
}

function BulkEditPanel({
  count,
  categories,
  vendors,
  parsStoreName,
  onVendorsChanged,
  onCategoriesChanged,
  onClear,
  onApply,
  onApplyPars,
}: {
  count: number
  categories: Category[]
  vendors: Vendor[]
  parsStoreName: string
  onVendorsChanged: (v: Vendor) => void
  onCategoriesChanged: () => void
  onClear: () => void
  onApply: (payload: Record<string, unknown>) => Promise<void>
  onApplyPars: (pars: { parLevel?: number | null; reorderPoint?: number | null }) => Promise<void>
}) {
  const [categoryChoice, setCategoryChoice] = useState("__nochange__")
  const [subcategoryTouched, setSubcategoryTouched] = useState(false)
  const [subcategory, setSubcategory] = useState("")
  const [glTouched, setGlTouched] = useState(false)
  const [glCodeOverride, setGlCodeOverride] = useState("")
  const [vendorChoice, setVendorChoice] = useState("__nochange__")
  const [parTouched, setParTouched] = useState(false)
  const [parLevel, setParLevel] = useState("")
  const [reorderTouched, setReorderTouched] = useState(false)
  const [reorderPoint, setReorderPoint] = useState("")
  const [applying, setApplying] = useState(false)
  const [quickAdd, setQuickAdd] = useState<"category" | "vendor" | null>(null)
  const [quickAddName, setQuickAddName] = useState("")
  const [quickAddGl, setQuickAddGl] = useState("")

  async function handleQuickAdd() {
    if (quickAdd === "category") {
      const res = await fetch("/api/inventory/ingredient-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: quickAddName, glCode: quickAddGl || null }),
      })
      if (res.ok) {
        const created = await res.json()
        setCategoryChoice(created.id)
        onCategoriesChanged()
      }
    } else if (quickAdd === "vendor") {
      const res = await fetch("/api/inventory/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: quickAddName }),
      })
      if (res.ok) {
        const created = await res.json()
        onVendorsChanged(created)
        setVendorChoice(created.id)
      }
    }
    setQuickAdd(null)
    setQuickAddName("")
    setQuickAddGl("")
  }

  async function handleApply() {
    setApplying(true)
    try {
      const payload: Record<string, unknown> = {}
      if (categoryChoice === "__clear__") payload.categoryId = null
      else if (categoryChoice !== "__nochange__") payload.categoryId = categoryChoice
      if (subcategoryTouched) payload.subcategory = subcategory || null
      if (glTouched) payload.glCodeOverride = glCodeOverride || null
      if (vendorChoice !== "__nochange__") payload.vendorId = vendorChoice

      if (parTouched || reorderTouched) {
        await onApplyPars({
          ...(parTouched && { parLevel: parLevel.trim() === "" ? null : Number(parLevel) }),
          ...(reorderTouched && { reorderPoint: reorderPoint.trim() === "" ? null : Number(reorderPoint) }),
        })
      }
      if (Object.keys(payload).length > 0) await onApply(payload)
      else onClear()
    } finally {
      setApplying(false)
    }
  }

  const parInvalid =
    (parTouched && parLevel.trim() !== "" && !(Number(parLevel) >= 0)) ||
    (reorderTouched && reorderPoint.trim() !== "" && !(Number(reorderPoint) >= 0))

  async function handleAction(action: "archive" | "unarchive" | "delete") {
    setApplying(true)
    try {
      await onApply({ action })
    } finally {
      setApplying(false)
    }
  }

  const hasEdits =
    categoryChoice !== "__nochange__" ||
    subcategoryTouched ||
    glTouched ||
    vendorChoice !== "__nochange__" ||
    parTouched ||
    reorderTouched

  return (
    <div className="border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 rounded-lg p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--color-foreground)]">{count} selected</p>
        <button onClick={onClear} className="text-xs text-[var(--color-muted-foreground)] hover:underline">Clear selection</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={categoryChoice} onValueChange={(v) => (v === "__newcategory__" ? setQuickAdd("category") : setCategoryChoice(v))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__nochange__">No change</SelectItem>
              <SelectItem value="__clear__">Clear category</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              <SelectItem value="__newcategory__">+ New category...</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Subcategory</Label>
          <Input
            className="h-9"
            placeholder="No change"
            value={subcategory}
            onChange={(e) => {
              setSubcategory(e.target.value)
              setSubcategoryTouched(true)
            }}
          />
        </div>
        <div>
          <Label className="text-xs">GL Code Override</Label>
          <Input
            className="h-9"
            placeholder="No change"
            value={glCodeOverride}
            onChange={(e) => {
              setGlCodeOverride(e.target.value)
              setGlTouched(true)
            }}
          />
        </div>
        <div>
          <Label className="text-xs">Default Vendor</Label>
          <Select value={vendorChoice} onValueChange={(v) => (v === "__newvendor__" ? setQuickAdd("vendor") : setVendorChoice(v))}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__nochange__">No change</SelectItem>
              {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              <SelectItem value="__newvendor__">+ New vendor...</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {parsStoreName && (
          <>
            <div>
              <Label className="text-xs">Par Level ({parsStoreName}, reporting units)</Label>
              <Input
                className="h-9"
                type="number"
                min={0}
                placeholder="No change — blank clears"
                value={parLevel}
                onChange={(e) => {
                  setParLevel(e.target.value)
                  setParTouched(true)
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Reorder Point ({parsStoreName}, reporting units)</Label>
              <Input
                className="h-9"
                type="number"
                min={0}
                placeholder="No change — blank clears"
                value={reorderPoint}
                onChange={(e) => {
                  setReorderPoint(e.target.value)
                  setReorderTouched(true)
                }}
              />
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={handleApply} disabled={!hasEdits || applying || parInvalid}>Apply to {count}</Button>
        <Button size="sm" variant="outline" onClick={() => handleAction("archive")} disabled={applying}>Archive</Button>
        <Button size="sm" variant="outline" onClick={() => handleAction("unarchive")} disabled={applying}>Unarchive</Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="text-[var(--color-destructive)]" disabled={applying}>Delete</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {count} ingredients?</AlertDialogTitle>
              <AlertDialogDescription>
                They&apos;ll move to View Deleted and can be restored later. They won&apos;t appear in counts, POs, or recipes
                while deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleAction("delete")}
                className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={!!quickAdd} onOpenChange={(o) => !o && setQuickAdd(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{quickAdd === "category" ? "New Category" : "New Vendor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={quickAddName} onChange={(e) => setQuickAddName(e.target.value)} />
            </div>
            {quickAdd === "category" && (
              <div>
                <Label>GL Code</Label>
                <Input value={quickAddGl} onChange={(e) => setQuickAddGl(e.target.value)} placeholder="5510" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAdd(null)}>Cancel</Button>
            <Button onClick={handleQuickAdd} disabled={!quickAddName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IngredientDialog({
  ingredient,
  categories,
  archivedAndDeletedNames,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient | null | undefined
  categories: Category[]
  archivedAndDeletedNames: { id: string; brand: string | null; name: string }[]
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
            subcategory: ingredient.subcategory ?? "",
            sku: ingredient.sku ?? "",
            purchaseUnitLabel: ingredient.purchaseUnitLabel,
            packDescription: ingredient.packDescription ?? "",
            purchaseCost: ingredient.purchaseCost.toString(),
            reportingUnit: ingredient.reportingUnit,
            unitsPerPurchase: ingredient.unitsPerPurchase.toString(),
            glCodeOverride: ingredient.glCodeOverride ?? "",
            productNote: ingredient.productNote ?? "",
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

  const duplicateMatch = useMemo(() => {
    if (!form.name.trim() || ingredient) return null
    const candidateName = form.brand ? `${form.brand} ${form.name}` : form.name
    return archivedAndDeletedNames.find((c) => {
      const otherName = c.brand ? `${c.brand} ${c.name}` : c.name
      return isCloseNameMatch(candidateName, otherName)
    })
  }, [form.name, form.brand, archivedAndDeletedNames, ingredient])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        brand: form.brand || null,
        name: form.name,
        categoryId: form.categoryId || null,
        subcategory: form.subcategory || null,
        sku: form.sku || null,
        purchaseUnitLabel: form.purchaseUnitLabel,
        packDescription: form.packDescription || null,
        purchaseCost: Number(form.purchaseCost),
        reportingUnit: form.reportingUnit,
        unitsPerPurchase: Number(form.unitsPerPurchase),
        glCodeOverride: form.glCodeOverride || null,
        productNote: form.productNote || null,
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
          {duplicateMatch && (
            <p className="text-xs text-[var(--color-warning-text)] bg-[var(--color-warning-text)]/10 rounded-md px-3 py-2">
              A version of &quot;{duplicateMatch.brand ? `${duplicateMatch.brand} ` : ""}{duplicateMatch.name}&quot; already exists
              (archived or deleted) — restore it instead?
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label>Subcategory (optional)</Label>
              <Input value={form.subcategory} onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SKU (optional)</Label>
              <Input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
            </div>
            <div>
              <Label>GL Code Override (optional)</Label>
              <Input placeholder="Uses category GL code if blank" value={form.glCodeOverride} onChange={(e) => setForm((f) => ({ ...f, glCodeOverride: e.target.value }))} />
            </div>
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
            <Label>Product Note (optional)</Label>
            <Textarea placeholder="Reorder link, prep note..." value={form.productNote} onChange={(e) => setForm((f) => ({ ...f, productNote: e.target.value }))} />
          </div>
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
