import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import { expandRecipeToIngredients, type CostGraph } from "@/lib/recipe-cost"

// ─── N-5b: theoretical usage from order-line modifiers ───────────────────────
// SalesModifierCache holds Σ (line qty × modifier qty) per store × day ×
// Square modifier id. This turns a window of it into per-ingredient usage
// through each modifier's recipe, the same way item sales turn into usage, so
// the two computation sites — salesUsageForWindow (expected on-hand, weekly
// usage → pars, low-stock alerts, order guide) and the variance report — share
// ONE set of rules and cannot drift:
//
//   - mapped (has a modifier recipe)  → expanded in the caller's mode; linear
//     and sign-preserving, so a "No X" removal's negative lines SUBTRACT;
//   - on by default in Square         → skipped silently (R5, Gary 2026-11-04:
//     "Their ingredients are already in the drink recipe, and removals come
//     through the “No X” add-ons") — even if it carries a recipe;
//   - NON_RECIPE                      → skipped silently;
//   - no recipe, or not synced        → skipped and COUNTED (R3: "Skip add-ons
//     with no recipe and show how many sold");
//   - recipe that loops / can't convert → listed, never treated as zero.
//
// Days cached before N-5b carry modifiersCaptured=false and have no modifier
// rows; they are counted, never read as "no add-ons sold" (R1b: "older days
// should say they have no add-on data"). Sales only — refunds are not read
// (R2).

export type ModifierContribution = {
  squareModifierId: string
  name: string
  /** Σ (line qty × modifier qty) in the window */
  qtySold: number
  /** this modifier's contribution to the ingredient, reporting units, signed */
  qty: number
}

export type ModifierUsageResult = {
  /** ingredientId → signed quantity in reporting units */
  usage: Map<string, number>
  /** ingredientId → per-modifier contributions (variance hover) */
  contributions: Map<string, ModifierContribution[]>
  /** distinct modifiers sold in the window with no recipe (and not NON_RECIPE / on by default) */
  unmappedModifierSoldCount: number
  /** cached days in the window synced before N-5b — no add-on data exists for them */
  modifierDataMissingDays: number
  /** modifier recipes that failed to expand; shaped like the item list so callers can merge */
  expansionProblems: { salesItemId: string; displayName: string }[]
}

export async function modifierUsageForWindow(
  organizationId: string,
  storeId: string,
  start: string,
  end: string,
  graph: CostGraph,
  mode: "theoretical" | "consumption"
): Promise<ModifierUsageResult> {
  const result: ModifierUsageResult = {
    usage: new Map(),
    contributions: new Map(),
    unmappedModifierSoldCount: 0,
    modifierDataMissingDays: 0,
    expansionProblems: [],
  }
  if (start > end) return result

  const window = { gte: dbDate(start), lte: dbDate(end) }
  const [rows, missingDays] = await Promise.all([
    prisma.salesModifierCache.findMany({ where: { storeId, date: window }, select: { squareModifierId: true, quantity: true } }),
    prisma.salesPeriodCache.count({ where: { storeId, date: window, modifiersCaptured: false } }),
  ])
  result.modifierDataMissingDays = missingDays

  const qtyByModifier = new Map<string, number>()
  for (const r of rows) qtyByModifier.set(r.squareModifierId, (qtyByModifier.get(r.squareModifierId) ?? 0) + r.quantity)
  if (qtyByModifier.size === 0) return result

  const modifiers = await prisma.squareModifier.findMany({
    where: { organizationId, squareModifierId: { in: [...qtyByModifier.keys()] } },
    select: { id: true, squareModifierId: true, name: true, onByDefault: true, recipeStatus: true, recipe: { select: { id: true } } },
  })
  const bySquareId = new Map(modifiers.map((m) => [m.squareModifierId, m]))

  for (const [squareModifierId, qtySold] of qtyByModifier) {
    if (qtySold === 0) continue
    const mod = bySquareId.get(squareModifierId)
    if (!mod) {
      // Sold but not in the synced catalog (created after the last Sync from
      // Square) — no recipe can exist for it.
      result.unmappedModifierSoldCount++
      continue
    }
    if (mod.onByDefault) continue // R5
    if (!mod.recipe) {
      if (mod.recipeStatus !== "NON_RECIPE") result.unmappedModifierSoldCount++
      continue
    }
    const expanded = expandRecipeToIngredients(graph, mod.recipe.id, qtySold, mode)
    if (expanded === null) {
      // `modifier:` prefix: this is a SquareModifier id, never a SalesItem id.
      result.expansionProblems.push({ salesItemId: `modifier:${mod.id}`, displayName: `${mod.name} (add-on)` })
      continue
    }
    for (const [ingredientId, qty] of expanded) {
      result.usage.set(ingredientId, (result.usage.get(ingredientId) ?? 0) + qty)
      const list = result.contributions.get(ingredientId) ?? []
      list.push({ squareModifierId, name: mod.name, qtySold, qty })
      result.contributions.set(ingredientId, list)
    }
  }
  return result
}
