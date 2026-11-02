"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import type { Allergen } from "@prisma/client"
import { FileText, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NUTRIENTS, allergenLabel, type NutrientKey, type NutrientValues } from "@/lib/nutrition"
import type { ItemVerification } from "@/lib/nutrition-proof"

export type MenuItemRow = {
  salesItemId: string
  recipeId: string
  name: string
  menuGroup: string | null
  totals: NutrientValues
  allergens: Allergen[]
  foodIngredientCount: number
  withNutritionCount: number
  incompleteNutrients: NutrientKey[]
  complete: boolean
  error: string | null
  // N-1b
  verification: ItemVerification
  verifiedIngredientCount: number
  staleIngredientCount: number
}

export type BlockerRow = {
  ingredientId: string
  name: string
  kind: "missing" | "partial" | "unverified"
  missingNutrients: NutrientKey[]
  itemCount: number
  stale?: boolean
}

const BLOCKER_BADGE = (b: BlockerRow) =>
  b.kind === "missing" ? "No nutrition" : b.kind === "partial" ? "Some values missing" : b.stale ? "Re-check label" : "Not verified"

// N-1b: the Proof column. Estimated is the honest default, not an error, so it
// is muted; Verified is the success colour; stale is the warning colour.
function ProofCell({ i }: { i: MenuItemRow }) {
  if (i.verification === "NO_FOOD") return <span className="text-[var(--color-muted-foreground)]">No food</span>
  if (i.verification === "VERIFIED") return <span className="text-[#25ba3b]">Verified</span>
  if (i.staleIngredientCount > 0) {
    return <span className="text-[#efa201]">Re-check label · {i.staleIngredientCount}</span>
  }
  return (
    <span className="text-[var(--color-muted-foreground)]">
      Estimated · {i.verifiedIngredientCount} of {i.foodIngredientCount} verified
    </span>
  )
}

type Detail = {
  id: string
  name: string
  totals: NutrientValues
  allergens: Allergen[]
  complete: boolean
  error: string | null
  foodIngredientCount: number
  missingIngredients: string[]
  partialIngredients: { name: string; missing: NutrientKey[] }[]
  verification: ItemVerification
  unverifiedIngredients: { name: string; stale: boolean }[]
  lines: {
    id: string
    name: string
    kind: "sub" | "prepared" | "ingredient"
    amount: number
    unit: string
    status: "ok" | "partial" | "missing" | "exempt" | "error"
    error: string | null
    contribution: NutrientValues | null
  }[]
}

// The list shows these; the detail view shows all fifteen.
const KEY_COLUMNS: NutrientKey[] = ["calories", "totalFatG", "totalCarbG", "totalSugarsG", "proteinG", "sodiumMg"]
const nutrientMeta = (k: NutrientKey) => NUTRIENTS.find((n) => n.key === k)!

// Display only. No FDA rounding — that is N-2's label work.
function fmt(v: number | null): string {
  if (v === null) return "—"
  return v >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString()
}

function NutrientCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#efa201]" title="Incomplete — an ingredient is missing this value">—</span>
  return <span className="tabular-nums">{fmt(value)}</span>
}

const LINE_STATUS: Record<Detail["lines"][number]["status"], { label: string; className: string }> = {
  ok: { label: "OK", className: "" },
  partial: { label: "Some values missing", className: "text-[#efa201]" },
  missing: { label: "No nutrition", className: "text-[#efa201]" },
  exempt: { label: "Not food", className: "text-[var(--color-muted-foreground)]" },
  error: { label: "Error", className: "text-[var(--color-destructive)]" },
}

export function MenuNutritionClient({
  items,
  blockers,
  withoutRecipeCount,
  canManage,
}: {
  items: MenuItemRow[]
  blockers: BlockerRow[]
  withoutRecipeCount: number
  canManage: boolean
}) {
  const [query, setQuery] = useState("")
  const [incompleteOnly, setIncompleteOnly] = useState(false)
  const [estimatedOnly, setEstimatedOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const latest = useRef<string | null>(null)

  const completeCount = items.filter((i) => i.complete).length
  // F8: items with no food ingredients are not counted, either way.
  const verifiable = items.filter((i) => i.verification !== "NO_FOOD")
  const verifiedCount = verifiable.filter((i) => i.verification === "VERIFIED").length
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (i) =>
        (!incompleteOnly || !i.complete) &&
        (!estimatedOnly || i.verification === "NOT_VERIFIED") &&
        (!q || i.name.toLowerCase().includes(q) || (i.menuGroup ?? "").toLowerCase().includes(q))
    )
  }, [items, query, incompleteOnly, estimatedOnly])

  async function open(recipeId: string) {
    latest.current = recipeId
    setOpenId(recipeId)
    setDetail(null)
    setDetailError(null)
    const res = await fetch(`/api/nutrition/recipes/${recipeId}`)
    const data = await res.json().catch(() => ({}))
    if (latest.current !== recipeId) return // a newer click won
    if (!res.ok) setDetailError(data.error ?? "Couldn't load this item")
    else setDetail(data)
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Menu Nutrition</h1>
        {canManage && (
          <Link
            href="/nutrition/import"
            className="inline-flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-2 text-sm hover:bg-[var(--color-muted)]"
          >
            <Upload className="h-4 w-4" /> Import nutrition
          </Link>
        )}
      </div>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
        Computed from each item&apos;s recipe and its ingredients&apos; nutrition. A dash means at least one ingredient is
        missing that value — Froot never counts an unknown as zero. Values here are unrounded; open an item and choose
        Label for its FDA-rounded Nutrition Facts.
      </p>

      {items.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No sales items have recipes yet. Add recipes under{" "}
          <Link href="/inventory/recipes" className="underline">Inventory → Recipes</Link>, then give their ingredients
          nutrition{canManage ? " on the ingredient page or with an import" : ""}.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--color-border)] p-4 mb-4 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">
              {completeCount} of {items.length} item{items.length === 1 ? "" : "s"} complete
            </span>
            <span className="text-[var(--color-muted-foreground)]">
              {" "}· {verifiedCount} of {verifiable.length} item{verifiable.length === 1 ? "" : "s"} verified
            </span>
            {withoutRecipeCount > 0 && (
              <span className="text-[var(--color-muted-foreground)]">
                {" "}· {withoutRecipeCount} sales item{withoutRecipeCount === 1 ? " has" : "s have"} no recipe yet
              </span>
            )}
          </div>

          {blockers.length > 0 && (
            <details className="rounded-lg border border-[var(--color-border)] mb-4">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                To fix, by how many items each blocks ({blockers.length})
              </summary>
              <ul className="px-4 pb-3 text-sm space-y-1">
                {blockers.map((b) => (
                  <li key={b.ingredientId} className="flex items-center justify-between gap-3">
                    <span>
                      {b.name}
                      {b.kind === "partial" && (
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {" "}— missing {b.missingNutrients.map((k) => nutrientMeta(k).label.toLowerCase()).join(", ")}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline">{BLOCKER_BADGE(b)}</Badge>
                      <span className="text-[var(--color-muted-foreground)] tabular-nums">{b.itemCount}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-4 mb-3">
            <Input placeholder="Search items or groups" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
            <div className="flex items-center gap-2">
              <Checkbox id="incomplete-only" checked={incompleteOnly} onCheckedChange={(v) => setIncompleteOnly(v === true)} />
              <Label htmlFor="incomplete-only" className="text-sm">Incomplete only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="estimated-only" checked={estimatedOnly} onCheckedChange={(v) => setEstimatedOnly(v === true)} />
              <Label htmlFor="estimated-only" className="text-sm">Estimated only</Label>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
                  <th className="text-left px-3 py-2 font-medium">Item</th>
                  {KEY_COLUMNS.map((k) => (
                    <th key={k} className="text-right px-3 py-2 font-medium whitespace-nowrap">
                      {nutrientMeta(k).label} ({nutrientMeta(k).unit})
                    </th>
                  ))}
                  <th className="text-left px-3 py-2 font-medium">Allergens</th>
                  <th className="text-left px-3 py-2 font-medium">Ingredients</th>
                  <th className="text-left px-3 py-2 font-medium">Proof</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr
                    key={i.salesItemId}
                    onClick={() => open(i.recipeId)}
                    className="border-b border-[var(--color-border)] last:border-0 cursor-pointer hover:bg-[var(--color-muted)]"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--color-foreground)]">{i.name}</div>
                      {i.menuGroup && <div className="text-xs text-[var(--color-muted-foreground)]">{i.menuGroup}</div>}
                    </td>
                    {KEY_COLUMNS.map((k) => (
                      <td key={k} className="text-right px-3 py-2"><NutrientCell value={i.totals[k]} /></td>
                    ))}
                    <td className="px-3 py-2 text-xs">{i.allergens.length ? i.allergens.map(allergenLabel).join(", ") : <span className="text-[var(--color-muted-foreground)]">None recorded</span>}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {i.error ? (
                        <span className="text-[var(--color-destructive)]">Recipe error</span>
                      ) : i.complete ? (
                        <span className="text-[#25ba3b]">Complete</span>
                      ) : (
                        <span className="text-[#efa201]">
                          {i.withNutritionCount} of {i.foodIngredientCount} have nutrition
                          {i.withNutritionCount === i.foodIngredientCount && ` · ${i.incompleteNutrients.length} value${i.incompleteNutrients.length === 1 ? "" : "s"} missing`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap"><ProofCell i={i} /></td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={KEY_COLUMNS.length + 4} className="px-3 py-6 text-center text-[var(--color-muted-foreground)]">
                      {estimatedOnly
                        ? "Every item matching your filters is verified."
                        : incompleteOnly
                          ? "Every item matching your search is complete."
                          : "No items match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-6">
              <DialogTitle>{items.find((i) => i.recipeId === openId)?.name ?? detail?.name ?? "Item"}</DialogTitle>
              {/* N-2: the item's Nutrition Facts label preview. */}
              {openId && (
                <Link
                  href={`/nutrition/menu/${items.find((i) => i.recipeId === openId)?.salesItemId}/label`}
                  className="inline-flex items-center gap-2 border border-[var(--color-border)] rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] shrink-0"
                >
                  <FileText className="h-4 w-4" /> Label
                </Link>
              )}
            </div>
          </DialogHeader>
          {detailError && <p className="text-sm text-[var(--color-destructive)]">{detailError}</p>}
          {!detail && !detailError && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {detail && (
            <div className="space-y-5 text-sm">
              {detail.error && (
                <div className="bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] rounded-lg px-3 py-2">
                  {detail.error} — every value is incomplete until this is fixed.
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
                {NUTRIENTS.map((n) => (
                  <div key={n.key} className="flex justify-between border-b border-[var(--color-border)] py-1">
                    <span>{n.label}</span>
                    <span>
                      <NutrientCell value={detail.totals[n.key]} />
                      {detail.totals[n.key] !== null && <span className="text-[var(--color-muted-foreground)]"> {n.unit}</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <span className="font-medium">Contains: </span>
                {detail.allergens.length ? detail.allergens.map(allergenLabel).join(", ") : <span className="text-[var(--color-muted-foreground)]">no allergens recorded</span>}
              </div>
              {(detail.missingIngredients.length > 0 || detail.partialIngredients.length > 0) && (
                <div className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <div className="font-medium mb-1">Blocking completeness</div>
                  <ul className="space-y-0.5 text-xs">
                    {detail.missingIngredients.map((name) => <li key={name}>{name} — no nutrition</li>)}
                    {detail.partialIngredients.map((p) => (
                      <li key={p.name}>{p.name} — missing {p.missing.map((k) => nutrientMeta(k).label.toLowerCase()).join(", ")}</li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.verification === "VERIFIED" ? (
                <p className="text-xs text-[#25ba3b]">Verified — every ingredient&apos;s nutrition is checked against a real label.</p>
              ) : detail.unverifiedIngredients.length > 0 ? (
                <div className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <div className="font-medium mb-1">Not verified yet</div>
                  <ul className="space-y-0.5 text-xs">
                    {detail.unverifiedIngredients.map((u) => (
                      <li key={u.name}>{u.name} — {u.stale ? "re-check label (verified over 12 months ago)" : "estimated"}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[var(--color-muted-foreground)]">
                      <th className="text-left py-1.5 pr-2 font-medium">Recipe line</th>
                      <th className="text-right py-1.5 px-2 font-medium">Amount</th>
                      <th className="text-right py-1.5 px-2 font-medium">Calories</th>
                      <th className="text-right py-1.5 px-2 font-medium">Sugars (g)</th>
                      <th className="text-left py-1.5 pl-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-1.5 pr-2">
                          {l.name}
                          {l.kind !== "ingredient" && <Badge variant="outline" className="ml-2">{l.kind === "sub" ? "Sub-recipe" : "Prep"}</Badge>}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{l.amount} {l.unit}</td>
                        <td className="py-1.5 px-2 text-right">{l.status === "exempt" ? "" : <NutrientCell value={l.contribution?.calories ?? null} />}</td>
                        <td className="py-1.5 px-2 text-right">{l.status === "exempt" ? "" : <NutrientCell value={l.contribution?.totalSugarsG ?? null} />}</td>
                        <td className={`py-1.5 pl-2 ${LINE_STATUS[l.status].className}`} title={l.error ?? undefined}>
                          {l.error ?? LINE_STATUS[l.status].label}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
