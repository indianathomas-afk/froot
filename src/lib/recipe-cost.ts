import { prisma } from "@/lib/prisma"
import { convert } from "@/lib/units"

// ─── Recipe cost engine (Phase I-6) ──────────────────────────────────────────
// Costs are computed at READ TIME from the org's full recipe graph — never
// stored on recipes — so edits to a sub-recipe or an ingredient price change
// (PO receipt) propagate to every dependent recipe automatically at any depth.
// The one stored exception: PREPARED ingredients keep a persisted
// costPerReportingUnit (counts and adjustments snapshot it); see
// recomputePreparedIngredientCosts below.
//
// Failure semantics: a loop or a dimension mismatch makes the affected costs
// null (UI shows N/A) — never a silent 0.

export type GraphLine = {
  id: string
  ingredientId: string | null
  subRecipeId: string | null
  amount: number
  unit: string
  sortOrder: number
}

export type GraphRecipe = {
  id: string
  name: string
  salesItemId: string | null
  yieldQty: number
  yieldUnit: string
  servingSizeQty: number | null
  servingSizeUnit: string | null
  isActive: boolean
  lines: GraphLine[]
}

export type GraphIngredient = {
  id: string
  name: string
  reportingUnit: string
  costPerReportingUnit: number
  kind: string
  preparedFromRecipeId: string | null
  isActive: boolean
  isArchived: boolean
}

export type CostGraph = {
  recipes: Map<string, GraphRecipe>
  ingredients: Map<string, GraphIngredient>
  /** recipeId of a prepared ingredient's source → the ingredient */
  preparedByRecipeId: Map<string, GraphIngredient>
}

export async function loadCostGraph(organizationId: string): Promise<CostGraph> {
  const [recipes, ingredients] = await Promise.all([
    prisma.recipe.findMany({
      where: { organizationId },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.ingredient.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        reportingUnit: true,
        costPerReportingUnit: true,
        kind: true,
        preparedFromRecipeId: true,
        isActive: true,
        isArchived: true,
      },
    }),
  ])
  const graph: CostGraph = {
    recipes: new Map(recipes.map((r) => [r.id, r])),
    ingredients: new Map(ingredients.map((i) => [i.id, i])),
    preparedByRecipeId: new Map(),
  }
  for (const i of ingredients) {
    if (i.preparedFromRecipeId) graph.preparedByRecipeId.set(i.preparedFromRecipeId, i)
  }
  return graph
}

// ─── Loop detection ───────────────────────────────────────────────────────────
// A looped recipe is one whose sub-recipe chain circles back to itself
// (A → B → C → A). Prepared-ingredient lines also traverse into their source
// recipe, since they cost through it.

export type Loop = { chainIds: string[]; chainNames: string[] }

export function loopErrorMessage(loop: Loop): string {
  return `A loop was detected: ${loop.chainNames.join(" → ")} — remove one of these references to fix it.`
}

function lineTargetRecipeId(graph: CostGraph, line: GraphLine): string | null {
  if (line.subRecipeId) return line.subRecipeId
  if (line.ingredientId) {
    const ing = graph.ingredients.get(line.ingredientId)
    if (ing?.preparedFromRecipeId && graph.recipes.has(ing.preparedFromRecipeId)) {
      return ing.preparedFromRecipeId
    }
  }
  return null
}

// DFS from startId; returns the first loop found reachable from it, or null.
export function findLoop(graph: CostGraph, startId: string): Loop | null {
  const stack: string[] = []
  const safe = new Set<string>()

  function visit(recipeId: string): Loop | null {
    const idx = stack.indexOf(recipeId)
    if (idx !== -1) {
      const chainIds = [...stack.slice(idx), recipeId]
      return {
        chainIds,
        chainNames: chainIds.map((id) => graph.recipes.get(id)?.name ?? "Unknown recipe"),
      }
    }
    if (safe.has(recipeId)) return null
    const recipe = graph.recipes.get(recipeId)
    if (!recipe) return null
    stack.push(recipeId)
    for (const line of recipe.lines) {
      const next = lineTargetRecipeId(graph, line)
      if (next) {
        const loop = visit(next)
        if (loop) return loop
      }
    }
    stack.pop()
    safe.add(recipeId)
    return null
  }

  return visit(startId)
}

// ─── Cost computation ─────────────────────────────────────────────────────────

export type LineCost = {
  lineId: string
  cost: number | null
  error: string | null
}

export type RecipeCost = {
  recipeId: string
  /** null when the recipe loops or any line fails (dimension mismatch etc.) */
  cost: number | null
  /** cost of one yield unit (cost / yieldQty), null when cost is null */
  costPerYieldUnit: number | null
  lines: LineCost[]
  error: string | null
  loop: Loop | null
}

type ComputeState = {
  memo: Map<string, RecipeCost>
  stack: string[]
}

export function computeRecipeCost(graph: CostGraph, recipeId: string, state?: ComputeState): RecipeCost {
  const s: ComputeState = state ?? { memo: new Map(), stack: [] }
  const memoized = s.memo.get(recipeId)
  if (memoized) return memoized

  const recipe = graph.recipes.get(recipeId)
  if (!recipe) {
    return { recipeId, cost: null, costPerYieldUnit: null, lines: [], error: "Recipe not found", loop: null }
  }

  const stackIdx = s.stack.indexOf(recipeId)
  if (stackIdx !== -1) {
    const chainIds = [...s.stack.slice(stackIdx), recipeId]
    const loop: Loop = {
      chainIds,
      chainNames: chainIds.map((id) => graph.recipes.get(id)?.name ?? "Unknown recipe"),
    }
    // Not memoized: the recipe gets its real (still-null) result when its own
    // frame unwinds; this placeholder only breaks the recursion.
    return { recipeId, cost: null, costPerYieldUnit: null, lines: [], error: loopErrorMessage(loop), loop }
  }

  s.stack.push(recipeId)
  const lines: LineCost[] = []
  let total = 0
  let failed: string | null = null
  let loop: Loop | null = null

  for (const line of recipe.lines) {
    let cost: number | null = null
    let error: string | null = null

    if (line.subRecipeId) {
      const sub = graph.recipes.get(line.subRecipeId)
      const subCost = sub ? computeRecipeCost(graph, sub.id, s) : null
      if (!sub || !subCost) {
        error = "Sub-recipe not found"
      } else if (subCost.cost === null) {
        error = subCost.loop ? loopErrorMessage(subCost.loop) : `"${sub.name}" has a cost error`
        loop = loop ?? subCost.loop
      } else {
        // amount is expressed in a unit convertible to the sub-recipe's yield unit
        const amountInYieldUnits = convert(line.amount, line.unit, sub.yieldUnit)
        if (amountInYieldUnits === null) {
          error = `Can't convert ${line.unit} to ${sub.yieldUnit} (the yield unit of "${sub.name}")`
        } else {
          cost = (subCost.cost / sub.yieldQty) * amountInYieldUnits
        }
      }
    } else if (line.ingredientId) {
      const ing = graph.ingredients.get(line.ingredientId)
      if (!ing) {
        error = "Ingredient not found"
      } else {
        let costPerReportingUnit: number | null = ing.costPerReportingUnit
        // Prepared ingredients cost through their source recipe so that edits
        // propagate immediately (the stored value is only a snapshot target).
        if (ing.preparedFromRecipeId && graph.recipes.has(ing.preparedFromRecipeId)) {
          const src = graph.recipes.get(ing.preparedFromRecipeId)!
          const srcCost = computeRecipeCost(graph, src.id, s)
          if (srcCost.cost === null) {
            error = srcCost.loop ? loopErrorMessage(srcCost.loop) : `"${src.name}" has a cost error`
            loop = loop ?? srcCost.loop
            costPerReportingUnit = null
          } else {
            costPerReportingUnit = srcCost.cost / src.yieldQty
          }
        }
        if (costPerReportingUnit !== null) {
          const qtyInReportingUnits = convert(line.amount, line.unit, ing.reportingUnit)
          if (qtyInReportingUnits === null) {
            error = `Can't convert ${line.unit} to ${ing.reportingUnit} (the reporting unit of "${ing.name}")`
          } else {
            cost = qtyInReportingUnits * costPerReportingUnit
          }
        }
      }
    } else {
      error = "Line has neither an ingredient nor a sub-recipe"
    }

    if (cost === null && !failed) failed = error ?? "Unknown cost error"
    if (cost !== null) total += cost
    lines.push({ lineId: line.id, cost, error })
  }

  s.stack.pop()
  const result: RecipeCost = {
    recipeId,
    cost: failed ? null : total,
    costPerYieldUnit: failed ? null : total / (recipe.yieldQty || 1),
    lines,
    error: failed,
    loop,
  }
  s.memo.set(recipeId, result)
  return result
}

// Compute costs for many recipes sharing one memo (e.g. the triage list).
export function computeAllRecipeCosts(graph: CostGraph): Map<string, RecipeCost> {
  const state: ComputeState = { memo: new Map(), stack: [] }
  for (const id of graph.recipes.keys()) computeRecipeCost(graph, id, state)
  return state.memo
}

export function costPct(cost: number | null, priceCents: number | null | undefined): number | null {
  if (cost === null || !priceCents || priceCents <= 0) return null
  return cost / (priceCents / 100)
}

// ─── Reverse reachability ─────────────────────────────────────────────────────
// All recipes that (transitively) use `recipeId` as a sub-recipe or via its
// prepared ingredient — powers "used in N recipes" and the propagation toast.

export function recipesUsing(graph: CostGraph, recipeId: string): Set<string> {
  // Build reverse edges once per call (graphs are small — hundreds of recipes).
  const reverse = new Map<string, string[]>()
  for (const r of graph.recipes.values()) {
    for (const line of r.lines) {
      const target = lineTargetRecipeId(graph, line)
      if (target) {
        const list = reverse.get(target) ?? []
        list.push(r.id)
        reverse.set(target, list)
      }
    }
  }
  const result = new Set<string>()
  const queue = [recipeId]
  while (queue.length) {
    const current = queue.pop()!
    for (const user of reverse.get(current) ?? []) {
      if (!result.has(user)) {
        result.add(user)
        queue.push(user)
      }
    }
  }
  return result
}

// ─── Recipe expansion ─────────────────────────────────────────────────────────
// Expands a recipe into per-ingredient quantities (in each ingredient's
// reporting unit). Returns null when the recipe loops or a unit can't convert —
// callers must surface that, never treat it as zero usage.
//
// mode "theoretical" (variance report): prepared-ingredient lines contribute
// BOTH to the prepared ingredient itself (it is counted and has its own
// variance row) AND to the raw ingredients inside its source recipe — selling a
// smoothie theoretically consumes the strawberries that went into the prep.
//
// mode "consumption" (recording a prep batch): prepared-ingredient lines stop
// at the prepared ingredient — the batch pulls the stocked prep item off the
// shelf, it does not consume that item's raws again.

export function expandRecipeToIngredients(
  graph: CostGraph,
  recipeId: string,
  multiplier: number,
  mode: "theoretical" | "consumption" = "theoretical"
): Map<string, number> | null {
  const out = new Map<string, number>()
  const stack: string[] = []

  function walk(id: string, mult: number): boolean {
    if (stack.includes(id)) return false // loop
    const recipe = graph.recipes.get(id)
    if (!recipe) return false
    stack.push(id)
    for (const line of recipe.lines) {
      if (line.subRecipeId) {
        const sub = graph.recipes.get(line.subRecipeId)
        if (!sub) return false
        const amountInYieldUnits = convert(line.amount, line.unit, sub.yieldUnit)
        if (amountInYieldUnits === null) return false
        if (!walk(sub.id, (mult * amountInYieldUnits) / sub.yieldQty)) return false
      } else if (line.ingredientId) {
        const ing = graph.ingredients.get(line.ingredientId)
        if (!ing) return false
        const qty = convert(line.amount, line.unit, ing.reportingUnit)
        if (qty === null) return false
        out.set(ing.id, (out.get(ing.id) ?? 0) + qty * mult)
        if (mode === "theoretical" && ing.preparedFromRecipeId && graph.recipes.has(ing.preparedFromRecipeId)) {
          const src = graph.recipes.get(ing.preparedFromRecipeId)!
          if (!walk(src.id, (qty * mult) / src.yieldQty)) return false
        }
      }
    }
    stack.pop()
    return true
  }

  return walk(recipeId, multiplier) ? out : null
}

// ─── Prepared-ingredient cost persistence ─────────────────────────────────────
// PREPARED ingredients carry a real stored costPerReportingUnit because counts,
// adjustments and valuation snapshot it. Call this after anything that can move
// ingredient costs: PO receipt, ingredient edit/import, vendor price change, or
// saving a countable recipe. Recipes whose cost is currently null (loop /
// dimension error) are skipped — a broken recipe must never zero out a cost.

export async function recomputePreparedIngredientCosts(
  organizationId: string
): Promise<{ ingredientId: string; name: string; oldCost: number; newCost: number }[]> {
  const graph = await loadCostGraph(organizationId)
  const state: ComputeState = { memo: new Map(), stack: [] }
  const changed: { ingredientId: string; name: string; oldCost: number; newCost: number }[] = []

  for (const [recipeId, ingredient] of graph.preparedByRecipeId) {
    const result = computeRecipeCost(graph, recipeId, state)
    if (result.costPerYieldUnit === null) continue
    const newCost = result.costPerYieldUnit
    if (Math.abs(newCost - ingredient.costPerReportingUnit) < 1e-9) continue
    changed.push({ ingredientId: ingredient.id, name: ingredient.name, oldCost: ingredient.costPerReportingUnit, newCost })
  }

  for (const c of changed) {
    await prisma.ingredient.update({
      where: { id: c.ingredientId },
      data: {
        costPerReportingUnit: c.newCost,
        costLogs: { create: { costPerReportingUnit: c.newCost, source: "PREP_RECOMPUTE" } },
      },
    })
  }
  return changed
}
