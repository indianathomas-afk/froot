import type { Allergen } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { convert } from "@/lib/units"
import { loadCostGraph, loopErrorMessage, type GraphIngredient, type GraphRecipe, type Loop } from "@/lib/recipe-cost"
import { NUTRIENT_KEYS, emptyNutrients, hasNutrition, sortAllergens, type NutrientKey, type NutrientValues } from "@/lib/nutrition"
import { proofState, type ProofState } from "@/lib/nutrition-proof"

// ─── Recipe nutrition engine (N-1) ───────────────────────────────────────────
// Mirrors src/lib/recipe-cost.ts: computed at READ TIME from the org's whole
// recipe graph (loaded by loadCostGraph — the same recipes, lines and
// ingredients cost sees), never stored. Same walk, same conversions:
//   - sub-recipe line: convert(amount, unit → sub.yieldUnit) ÷ sub.yieldQty
//   - ingredient line: convert(amount, unit → the nutrition basis unit)
//     ÷ basisAmount
//   - PREPARED ingredient: computed through its source recipe, as cost is —
//     never from a record of its own
//   - a recipe's totals are the WHOLE recipe (a sales recipe is one sold
//     item, as costPct treats it)
// It mirrors rather than shares the cost walk because cost folds to one
// number and this folds to a vector with per-nutrient completeness; sharing
// would mean changing cost math, which N-1 must not touch. It must not use
// expandRecipeToIngredients: its "theoretical" mode counts a prepared
// ingredient AND its raws.
//
// Failure semantics (N1-F5, Gary 2026-11-01): "Track completeness per
// nutrient. A unit-conversion failure or loop marks every nutrient
// incomplete." A nutrient is summed only while every contributing food line
// has it; one unknown makes that nutrient null for the recipe and everything
// above it. Unknown is never zero. Not-food lines (nutritionExempt)
// contribute nothing and never make a recipe incomplete.

export type NutritionRecord = {
  basisAmount: number
  basisUnit: string
  values: NutrientValues
}

export type NutritionIngredient = GraphIngredient & {
  brand: string | null
  nutritionExempt: boolean
  allergens: Allergen[]
  nutrition: NutritionRecord | null
  /** N-1b — absent in graphs built without proof (treated as not verified) */
  proof?: ProofState
}

export type NutritionGraph = {
  recipes: Map<string, GraphRecipe>
  ingredients: Map<string, NutritionIngredient>
}

// N1D-F1: a proof-only record (no basis) is "no nutrition" — the line takes
// the missing path in computeRecipeNutrition, never a partial or zero one.
// Pure, so scripts/verify-n1d.ts pins the mapping the loader uses.
export function nutritionRecordOf(
  n: ({ basisAmount: number | null; basisUnit: string | null } & Record<NutrientKey, number | null>) | null
): NutritionRecord | null {
  if (!hasNutrition(n)) return null
  return {
    basisAmount: n.basisAmount,
    basisUnit: n.basisUnit,
    values: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n[k]])) as NutrientValues,
  }
}

export async function loadNutritionGraph(organizationId: string, now = new Date()): Promise<NutritionGraph> {
  const [cost, extras] = await Promise.all([
    loadCostGraph(organizationId),
    prisma.ingredient.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, brand: true, nutritionExempt: true, allergens: true, nutrition: true },
    }),
  ])
  const byId = new Map(extras.map((e) => [e.id, e]))
  const ingredients = new Map<string, NutritionIngredient>()
  for (const ing of cost.ingredients.values()) {
    const e = byId.get(ing.id)
    const n = e?.nutrition ?? null
    ingredients.set(ing.id, {
      ...ing,
      brand: e?.brand ?? null,
      nutritionExempt: e?.nutritionExempt ?? false,
      allergens: e?.allergens ?? [],
      nutrition: nutritionRecordOf(n),
      proof: proofState(n, now),
    })
  }
  return { recipes: cost.recipes, ingredients }
}

// ─── Computation ──────────────────────────────────────────────────────────────

export type LineStatus = "ok" | "partial" | "missing" | "exempt" | "error"

export type LineNutrition = {
  lineId: string
  /** null when the line failed or its ingredient has no record */
  contribution: NutrientValues | null
  status: LineStatus
  error: string | null
}

export type RecipeNutrition = {
  recipeId: string
  /** per nutrient: a number, or null = incomplete (never silently low) */
  totals: NutrientValues
  allergens: Allergen[]
  /** distinct food ingredients reached (sub-recipes and preps walked through) */
  foodIngredientIds: Set<string>
  /** food ingredients with no nutrition record */
  missingIngredientIds: Set<string>
  /** food ingredients whose record lacks some nutrients → which */
  partialIngredients: Map<string, NutrientKey[]>
  lines: LineNutrition[]
  /** first conversion / loop / not-found error; every total is null when set */
  error: string | null
  loop: Loop | null
  /** every nutrient known and no error */
  complete: boolean
}

type State = { memo: Map<string, RecipeNutrition>; stack: string[] }

function scaled(values: NutrientValues, factor: number): NutrientValues {
  const out = emptyNutrients(null)
  for (const k of NUTRIENT_KEYS) {
    const v = values[k]
    out[k] = v === null ? null : v * factor
  }
  return out
}

export function computeRecipeNutrition(graph: NutritionGraph, recipeId: string, state?: State): RecipeNutrition {
  const s: State = state ?? { memo: new Map(), stack: [] }
  const memoized = s.memo.get(recipeId)
  if (memoized) return memoized

  const blank = (error: string, loop: Loop | null): RecipeNutrition => ({
    recipeId, totals: emptyNutrients(null), allergens: [], foodIngredientIds: new Set(),
    missingIngredientIds: new Set(), partialIngredients: new Map(), lines: [], error, loop, complete: false,
  })

  const recipe = graph.recipes.get(recipeId)
  if (!recipe) return blank("Recipe not found", null)

  const stackIdx = s.stack.indexOf(recipeId)
  if (stackIdx !== -1) {
    const chainIds = [...s.stack.slice(stackIdx), recipeId]
    const loop: Loop = { chainIds, chainNames: chainIds.map((id) => graph.recipes.get(id)?.name ?? "Unknown recipe") }
    // Not memoized — same as the cost engine: the recipe gets its real result
    // when its own frame unwinds.
    return blank(loopErrorMessage(loop), loop)
  }

  s.stack.push(recipeId)
  const totals = emptyNutrients(0)
  const allergens = new Set<Allergen>()
  const foodIngredientIds = new Set<string>()
  const missingIngredientIds = new Set<string>()
  const partialIngredients = new Map<string, NutrientKey[]>()
  const lines: LineNutrition[] = []
  let failed: string | null = null
  let loop: Loop | null = null

  // Fold a computed sub-result (sub-recipe or prepared source) into this one.
  const absorb = (sub: RecipeNutrition, factor: number | null): NutrientValues | null => {
    sub.allergens.forEach((a) => allergens.add(a))
    sub.foodIngredientIds.forEach((id) => foodIngredientIds.add(id))
    sub.missingIngredientIds.forEach((id) => missingIngredientIds.add(id))
    sub.partialIngredients.forEach((keys, id) => partialIngredients.set(id, keys))
    if (sub.error || factor === null) return null
    return scaled(sub.totals, factor)
  }

  for (const line of recipe.lines) {
    let contribution: NutrientValues | null = null
    let status: LineStatus = "ok"
    let error: string | null = null

    if (line.subRecipeId) {
      const sub = graph.recipes.get(line.subRecipeId)
      if (!sub) {
        error = "Sub-recipe not found"
      } else {
        const subN = computeRecipeNutrition(graph, sub.id, s)
        const inYield = convert(line.amount, line.unit, sub.yieldUnit)
        if (subN.error) {
          error = subN.loop ? loopErrorMessage(subN.loop) : `"${sub.name}" has a nutrition error`
          loop = loop ?? subN.loop
          absorb(subN, null)
        } else if (inYield === null) {
          error = `Can't convert ${line.unit} to ${sub.yieldUnit} (the yield unit of "${sub.name}")`
          absorb(subN, null)
        } else {
          contribution = absorb(subN, inYield / sub.yieldQty)
          status = subN.complete ? "ok" : "partial"
        }
      }
    } else if (line.ingredientId) {
      const ing = graph.ingredients.get(line.ingredientId)
      if (!ing) {
        error = "Ingredient not found"
      } else if (ing.preparedFromRecipeId && graph.recipes.has(ing.preparedFromRecipeId)) {
        // Prepared: through the source recipe, per reporting unit = total ÷ yieldQty
        // (the cost engine's rule, recipe-cost.ts computeRecipeCost).
        const src = graph.recipes.get(ing.preparedFromRecipeId)!
        const srcN = computeRecipeNutrition(graph, src.id, s)
        ing.allergens.forEach((a) => allergens.add(a))
        const qty = convert(line.amount, line.unit, ing.reportingUnit)
        if (srcN.error) {
          error = srcN.loop ? loopErrorMessage(srcN.loop) : `"${src.name}" has a nutrition error`
          loop = loop ?? srcN.loop
          absorb(srcN, null)
        } else if (qty === null) {
          error = `Can't convert ${line.unit} to ${ing.reportingUnit} (the reporting unit of "${ing.name}")`
          absorb(srcN, null)
        } else {
          contribution = absorb(srcN, qty / src.yieldQty)
          status = srcN.complete ? "ok" : "partial"
        }
      } else {
        // Allergens are unioned even from not-food lines: an allergen an admin
        // recorded is never dropped for tidiness.
        ing.allergens.forEach((a) => allergens.add(a))
        if (ing.nutritionExempt) {
          status = "exempt"
        } else {
          foodIngredientIds.add(ing.id)
          if (!ing.nutrition) {
            missingIngredientIds.add(ing.id)
            status = "missing"
          } else {
            const inBasis = convert(line.amount, line.unit, ing.nutrition.basisUnit)
            if (inBasis === null) {
              error = `Can't convert ${line.unit} to ${ing.nutrition.basisUnit} (the nutrition basis of "${ing.name}")`
            } else {
              contribution = scaled(ing.nutrition.values, inBasis / ing.nutrition.basisAmount)
              const unknown = NUTRIENT_KEYS.filter((k) => ing.nutrition!.values[k] === null)
              if (unknown.length > 0) {
                partialIngredients.set(ing.id, unknown)
                status = "partial"
              }
            }
          }
        }
      }
    } else {
      error = "Line has neither an ingredient nor a sub-recipe"
    }

    if (error) {
      status = "error"
      contribution = null
      if (!failed) failed = error
    }
    if (status !== "exempt") {
      for (const k of NUTRIENT_KEYS) {
        const v = contribution?.[k] ?? null
        totals[k] = totals[k] === null || v === null ? null : totals[k]! + v
      }
    }
    lines.push({ lineId: line.id, contribution, status, error })
  }

  s.stack.pop()
  const finalTotals = failed ? emptyNutrients(null) : totals
  const result: RecipeNutrition = {
    recipeId,
    totals: finalTotals,
    allergens: sortAllergens(allergens),
    foodIngredientIds,
    missingIngredientIds,
    partialIngredients,
    lines,
    error: failed,
    loop,
    complete: !failed && NUTRIENT_KEYS.every((k) => finalTotals[k] !== null),
  }
  s.memo.set(recipeId, result)
  return result
}

export function computeAllRecipeNutrition(graph: NutritionGraph): Map<string, RecipeNutrition> {
  const state: State = { memo: new Map(), stack: [] }
  for (const id of graph.recipes.keys()) computeRecipeNutrition(graph, id, state)
  return state.memo
}

export function incompleteNutrients(n: RecipeNutrition): NutrientKey[] {
  return NUTRIENT_KEYS.filter((k) => n.totals[k] === null)
}

// ─── "To fix": ingredients blocking completeness, ranked ──────────────────────
// The BEV-1 pattern: each ingredient that blocks at least one item, with how
// many items it blocks. "missing" = no record at all; "partial" = a record
// with some nutrients unknown (which ones are listed). N-1b adds "unverified"
// = a complete-enough record that is ESTIMATED or STALE — it blocks an item
// from showing Verified. Pass proofOf to include it; one entry per ingredient,
// so an ingredient that is partial AND unverified shows as partial until its
// values are filled in, then as unverified.

export type Blocker = {
  ingredientId: string
  kind: "missing" | "partial" | "unverified"
  missingNutrients: NutrientKey[]
  itemCount: number
  /** unverified only: VERIFIED but older than the stale window */
  stale?: boolean
}

const KIND_RANK: Record<Blocker["kind"], number> = { missing: 0, partial: 1, unverified: 2 }

export function rankBlockers(
  results: Iterable<RecipeNutrition>,
  proofOf?: (ingredientId: string) => ProofState
): Blocker[] {
  const map = new Map<string, Blocker>()
  for (const r of results) {
    for (const id of r.missingIngredientIds) {
      const b = map.get(id) ?? { ingredientId: id, kind: "missing", missingNutrients: [], itemCount: 0 }
      b.itemCount++
      map.set(id, b)
    }
    for (const [id, keys] of r.partialIngredients) {
      if (r.missingIngredientIds.has(id)) continue
      const b = map.get(id) ?? { ingredientId: id, kind: "partial", missingNutrients: keys, itemCount: 0 }
      b.itemCount++
      map.set(id, b)
    }
    if (!proofOf) continue
    for (const id of r.foodIngredientIds) {
      if (r.missingIngredientIds.has(id) || r.partialIngredients.has(id)) continue
      const p = proofOf(id)
      if (p === "VERIFIED" || p === "NONE") continue
      const b = map.get(id) ?? { ingredientId: id, kind: "unverified", missingNutrients: [], itemCount: 0, stale: p === "STALE" }
      b.itemCount++
      map.set(id, b)
    }
  }
  return [...map.values()].sort((a, b) =>
    a.kind !== b.kind ? KIND_RANK[a.kind] - KIND_RANK[b.kind] : b.itemCount - a.itemCount
  )
}
