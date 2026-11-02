import type { Allergen } from "@prisma/client"
import { ALLERGENS, NUTRIENT_KEYS, allergenLabel, type NutrientKey } from "@/lib/nutrition"
import { buildLabel, resolveServing, type ItemOverride, type LabelValue, type NutritionLabel } from "@/lib/nutrition-label"
import { itemVerification } from "@/lib/nutrition-proof"
import { computeAllRecipeNutrition, type NutritionGraph } from "@/lib/recipe-nutrition"
import type { ServingSettings } from "@/lib/nutrition-serving"

// ─── Public nutrition menu (N-3) ─────────────────────────────────────────────
// PURE — no database, no Next. The ONE place the public payload is built:
// /menu/[slug] renders only what buildPublicMenu returns, never an app-side
// object, and scripts/verify-n3-public.ts walks its keys. Rulings:
// docs/DECISIONS.md 2026-11-02 N-3 (Gary, DRAFT): "Accept all leans" — forks
// N3-F1–F8 and R-1–R-3 as written in docs/prompts/N-3_AUDIT.md.
//
// What may leave the app (prompt item 4): item and size names, menu group
// names, rounded label values for Verified sizes, allergen labels, the
// disclaimer and cross-contact texts, the org's display name, and a
// "last updated" date. NEVER prices, costs, ingredient names or amounts,
// recipes, vendors, label documents or links, user names, or database ids.
//
// A size is PUBLIC-VERIFIED (shows numbers) only when ALL of:
//   - itemVerification is VERIFIED — every food ingredient reached is
//     Verified and not stale (N-1b); errors and no-food items are not (N3-F8);
//   - every nutrient is known (N3-F6: no "—" on a public panel);
//   - the label builds.
// Everything else in an included, visible item is "Nutrition coming soon"
// with no numbers and no allergens (N3-F1). Allergens are shown for an item
// only when EVERY size is public-verified (N3-F7) — a partial set at item
// level is the dangerous direction. NON_RECIPE items are left off (N3-F8).

export const DEFAULT_DISCLAIMER =
  "Nutrition values are for our standard recipes. Customizations, add-ons and substitutions change nutrition."
export const DEFAULT_CROSS_CONTACT =
  "Our drinks are blended on shared equipment, so any item may contain traces of allergens not listed."
export const TEXT_MAX = 1000

/** Group names the publish page offers to leave UNticked in its suggested set (N3-F3: nothing is ticked by default). */
const SUGGESTED_EXCLUDE = /archiv|retail|shirt|mug|drinkware|bouquet|service|fundrais|supplement|misc|event|blend ins/i
export function suggestedInclude(groupName: string): boolean {
  return !SUGGESTED_EXCLUDE.test(groupName)
}

// ─── Slug ─────────────────────────────────────────────────────────────────────
export const SLUG_MIN = 3
export const SLUG_MAX = 60

/** Trimmed and lowercased. Callers store what this returns. */
export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

export function slugError(slug: string): string | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return `Web address must be ${SLUG_MIN}–${SLUG_MAX} characters`
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Use lowercase letters, numbers and single hyphens (no hyphen at either end)"
  return null
}

// ─── Inputs ───────────────────────────────────────────────────────────────────
export type PublicMenuSalesItem = {
  squareItemId: string
  /** the Square item name (not displayName, which carries the size) */
  name: string
  variationName: string
  squareCategoryId: string | null
  recipeStatus: string
  recipeId: string | null
  override: ItemOverride | null
}

export type PublicMenuInput = {
  orgName: string
  disclaimer: string | null
  crossContactNotice: string | null
  includedCategoryIds: ReadonlySet<string>
  hiddenSquareItemIds: ReadonlySet<string>
  /** SquareCategory row id → name */
  categories: ReadonlyMap<string, string>
  salesItems: PublicMenuSalesItem[]
  graph: NutritionGraph
  serving: ServingSettings
  /** IngredientNutrition.verifiedAt for "Last updated" */
  verifiedAtOf: (ingredientId: string) => Date | null
}

// ─── The public payload ───────────────────────────────────────────────────────
/** The panel the public page draws — exactly the fields NutritionFactsLabel reads. */
export type PublicLabel = Pick<NutritionLabel, "servingSize" | "servingsPerContainer" | "dual" | "columns" | "contains">

export type PublicSize = {
  name: string
  /** whole item as sold (N3-F2), e.g. "390"; null = coming soon */
  calories: string | null
  label: PublicLabel | null
}

export type PublicItem = {
  name: string
  /** allergen display labels; null = not shown (N3-F1, N3-F7) */
  allergens: string[] | null
  sizes: PublicSize[]
}

export type PublicMenuPayload = {
  orgName: string
  disclaimer: string
  crossContactNotice: string
  /** YYYY-MM-DD (UTC) of the most recent verification among shown sizes; null when none */
  lastUpdated: string | null
  groups: { name: string; items: PublicItem[] }[]
}

/** Labels the allergen filter offers, in statute order. */
export const PUBLIC_ALLERGEN_LABELS: string[] = ALLERGENS.map((a) => a.label)

function publicLabel(l: NutritionLabel): PublicLabel {
  // Rebuilt field by field so nothing else on NutritionLabel (spec, servings,
  // `actual` amounts) can ride along.
  return {
    servingSize: l.servingSize,
    servingsPerContainer: l.servingsPerContainer,
    dual: l.dual,
    contains: l.contains,
    columns: l.columns.map((c) => ({
      heading: c.heading,
      values: Object.fromEntries(
        NUTRIENT_KEYS.map((k): [NutrientKey, LabelValue] => {
          const v = c.values[k]
          return [k, v.missing ? { missing: true, text: "—", dv: null } : { missing: false, text: v.text, dv: v.dv }]
        })
      ) as Record<NutrientKey, LabelValue>,
    })),
  }
}

/** Per-size public status, shared by the payload and the publish page's counts. */
export type SizeStatus = { verified: true; label: NutritionLabel; allergens: Allergen[]; foodIngredientIds: Set<string> } | { verified: false }

export function sizeStatuses(input: Pick<PublicMenuInput, "salesItems" | "graph" | "serving">): SizeStatus[] {
  const results = computeAllRecipeNutrition(input.graph)
  const proofOf = (id: string) => input.graph.ingredients.get(id)?.proof ?? "NONE"
  return input.salesItems.map((s): SizeStatus => {
    const n = s.recipeId ? results.get(s.recipeId) : undefined
    if (!n || n.error || !n.complete) return { verified: false }
    if (itemVerification(n, proofOf) !== "VERIFIED") return { verified: false }
    const spec = resolveServing({ variationName: s.variationName, orgServingFlOz: input.serving.orgServingFlOz, sizeTable: input.serving.sizeTable, override: s.override })
    const built = buildLabel({ totals: n.totals, allergens: n.allergens, error: n.error, verification: "VERIFIED" }, spec)
    if (!built.ok) return { verified: false }
    return { verified: true, label: built.label, allergens: n.allergens, foodIngredientIds: n.foodIngredientIds }
  })
}

/** Size order on the menu: by volume when the size table knows it, then by name. */
function sizeOrder(serving: ServingSettings, s: PublicMenuSalesItem): number {
  return s.override?.volumeFlOz ?? serving.sizeTable.get(s.variationName) ?? Number.POSITIVE_INFINITY
}

/** Whether a sales item can appear at all: included group, not hidden, not NON_RECIPE. */
export function isListed(s: Pick<PublicMenuSalesItem, "squareCategoryId" | "squareItemId" | "recipeStatus">, included: ReadonlySet<string>, hidden: ReadonlySet<string>): boolean {
  return !!s.squareCategoryId && included.has(s.squareCategoryId) && !hidden.has(s.squareItemId) && s.recipeStatus !== "NON_RECIPE"
}

export function buildPublicMenu(input: PublicMenuInput): PublicMenuPayload {
  const statuses = sizeStatuses(input)
  let last: number | null = null

  // group (category id) → item (square item id) → sizes
  const groups = new Map<string, Map<string, { name: string; sizes: { s: PublicMenuSalesItem; st: SizeStatus }[] }>>()
  input.salesItems.forEach((s, i) => {
    if (!isListed(s, input.includedCategoryIds, input.hiddenSquareItemIds)) return
    const g = groups.get(s.squareCategoryId!) ?? new Map()
    groups.set(s.squareCategoryId!, g)
    const item = g.get(s.squareItemId) ?? { name: s.name, sizes: [] }
    g.set(s.squareItemId, item)
    item.sizes.push({ s, st: statuses[i] })
  })

  const out: PublicMenuPayload["groups"] = []
  for (const [categoryId, items] of groups) {
    const list: PublicItem[] = []
    for (const item of items.values()) {
      item.sizes.sort((a, b) => sizeOrder(input.serving, a.s) - sizeOrder(input.serving, b.s) || a.s.variationName.localeCompare(b.s.variationName))
      const allVerified = item.sizes.every((x) => x.st.verified)
      const allergens = new Set<Allergen>()
      const sizes: PublicSize[] = item.sizes.map(({ s, st }) => {
        if (!st.verified) return { name: s.variationName, calories: null, label: null }
        st.allergens.forEach((a) => allergens.add(a))
        for (const id of st.foodIngredientIds) {
          const t = input.verifiedAtOf(id)?.getTime() ?? null
          if (t !== null && (last === null || t > last)) last = t
        }
        const label = publicLabel(st.label)
        // N3-F2: the whole item as sold = the last column (per container, or the only one).
        return { name: s.variationName, calories: label.columns[label.columns.length - 1].values.calories.text, label }
      })
      list.push({
        name: item.name,
        allergens: allVerified ? [...ALLERGENS.filter((a) => allergens.has(a.value)).map((a) => allergenLabel(a.value))] : null,
        sizes,
      })
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    out.push({ name: input.categories.get(categoryId) ?? "Menu", items: list })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))

  return {
    orgName: input.orgName,
    disclaimer: input.disclaimer?.trim() || DEFAULT_DISCLAIMER,
    crossContactNotice: input.crossContactNotice?.trim() || DEFAULT_CROSS_CONTACT,
    lastUpdated: last === null ? null : new Date(last).toISOString().slice(0, 10),
    groups: out,
  }
}

// ─── Off / unknown → not found ───────────────────────────────────────────────
/** The page renders only when this is true; otherwise a plain 404 (prompt item 6, R-2). */
export function menuIsLive(row: { enabled: boolean } | null, org: { activeModules: string[] } | null): boolean {
  if (!row || !org || !row.enabled) return false
  return org.activeModules.includes("inventory") && org.activeModules.includes("nutrition")
}

// ─── Publish page counts (prompt item 1) ─────────────────────────────────────
/** Per Square item: sizes that can be listed (not NON_RECIPE) and how many are public-verified. Units are ITEMS, as the menu shows them. */
export type ItemSummary = { squareItemId: string; squareCategoryId: string | null; listedSizes: number; verifiedSizes: number }

export function summarizeItems(salesItems: PublicMenuSalesItem[], statuses: SizeStatus[]): ItemSummary[] {
  const byItem = new Map<string, ItemSummary>()
  salesItems.forEach((s, i) => {
    const it = byItem.get(s.squareItemId) ?? { squareItemId: s.squareItemId, squareCategoryId: s.squareCategoryId, listedSizes: 0, verifiedSizes: 0 }
    byItem.set(s.squareItemId, it)
    if (s.recipeStatus === "NON_RECIPE") return
    it.listedSizes++
    if (statuses[i].verified) it.verifiedSizes++
  })
  return [...byItem.values()]
}

export function publishCounts(items: ItemSummary[], included: ReadonlySet<string>, hidden: ReadonlySet<string>) {
  let showing = 0, comingSoon = 0, hiddenCount = 0
  for (const it of items) {
    if (!it.squareCategoryId || !included.has(it.squareCategoryId) || it.listedSizes === 0) continue
    if (hidden.has(it.squareItemId)) hiddenCount++
    else if (it.verifiedSizes > 0) showing++
    else comingSoon++
  }
  return { showing, comingSoon, hidden: hiddenCount }
}
