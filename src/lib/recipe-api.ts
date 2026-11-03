import { z } from "zod"
import { compatibleUnits } from "@/lib/units"
import { findLoop, loopErrorMessage, recipeKind, type CostGraph, type GraphRecipe } from "@/lib/recipe-cost"

// ─── Shared request validation for the recipes API (Phase I-6) ───────────────

export const RecipeLineSchema = z
  .object({
    ingredientId: z.string().optional().nullable(),
    subRecipeId: z.string().optional().nullable(),
    // N-5: any non-zero number here; NEGATIVE lines are allowed on modifier
    // recipes only, which validateRecipeLines decides (it sees the recipe).
    amount: z.number().finite().refine((n) => n !== 0, { message: "Amount can't be zero" }),
    unit: z.string().min(1),
  })
  .refine((l) => !!l.ingredientId !== !!l.subRecipeId, {
    message: "Each line needs exactly one of an ingredient or a sub-recipe",
  })

export const RecipeSchema = z.object({
  name: z.string().min(1),
  salesItemId: z.string().optional().nullable(),
  // N-5: set only on create; a recipe never moves between a modifier and an item.
  squareModifierId: z.string().optional().nullable(),
  yieldQty: z.number().positive().default(1),
  yieldUnit: z.string().min(1).default("serving"),
  servingSizeQty: z.number().positive().optional().nullable(),
  servingSizeUnit: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  lines: z.array(RecipeLineSchema).default([]),
})

export type RecipeInput = z.infer<typeof RecipeSchema>

export function candidateFromInput(id: string, data: RecipeInput): GraphRecipe {
  return {
    id,
    name: data.name,
    salesItemId: data.salesItemId ?? null,
    squareModifierId: data.squareModifierId ?? null,
    yieldQty: data.yieldQty,
    yieldUnit: data.yieldUnit,
    servingSizeQty: data.servingSizeQty ?? null,
    servingSizeUnit: data.servingSizeUnit ?? null,
    isActive: data.isActive ?? true,
    lines: data.lines.map((l, i) => ({
      id: `__line_${i}__`,
      ingredientId: l.ingredientId ?? null,
      subRecipeId: l.subRecipeId ?? null,
      amount: l.amount,
      unit: l.unit,
      sortOrder: i,
    })),
  }
}

// Validates candidate lines against the org graph WITHOUT saving: dimension
// compatibility per line, then loop detection with the candidate grafted in.
// Returns a 422-able error payload or null.
export function validateRecipeLines(
  graph: CostGraph,
  candidate: GraphRecipe
): { error: string; loopRecipeIds?: string[]; lineErrors?: { index: number; error: string }[] } | null {
  // N-5 (N5-F2, N5-F8): one place for the modifier rules, because the recipe
  // API (create and the merged PATCH) and the BevSpot planner all come here.
  if (candidate.salesItemId && candidate.squareModifierId) {
    return { error: "A recipe can belong to a sales item or a modifier, not both" }
  }
  const isModifier = recipeKind(candidate) === "modifier"
  const lineErrors: { index: number; error: string }[] = []
  candidate.lines.forEach((line, index) => {
    if (!Number.isFinite(line.amount) || line.amount === 0) {
      return void lineErrors.push({ index, error: "Amount can't be zero" })
    }
    if (line.amount < 0 && !isModifier) {
      return void lineErrors.push({ index, error: "Only modifier recipes can have negative amounts (removals and swaps)" })
    }
    if (line.subRecipeId) {
      const sub = graph.recipes.get(line.subRecipeId)
      if (!sub) return void lineErrors.push({ index, error: "Sub-recipe not found" })
      if (sub.id === candidate.id) return void lineErrors.push({ index, error: "A recipe can't contain itself" })
      if (recipeKind(sub) === "modifier") {
        return void lineErrors.push({ index, error: `"${sub.name}" is a modifier recipe and can't be used inside another recipe` })
      }
      if (!compatibleUnits(sub.yieldUnit).includes(line.unit)) {
        lineErrors.push({ index, error: `Unit must be convertible to ${sub.yieldUnit} (the yield unit of "${sub.name}")` })
      }
    } else if (line.ingredientId) {
      const ing = graph.ingredients.get(line.ingredientId)
      if (!ing) return void lineErrors.push({ index, error: "Ingredient not found" })
      if (!compatibleUnits(ing.reportingUnit).includes(line.unit)) {
        lineErrors.push({ index, error: `Unit must be convertible to ${ing.reportingUnit} (the reporting unit of "${ing.name}")` })
      }
    }
  })
  if (lineErrors.length) return { error: "Some lines have problems", lineErrors }

  const hadCandidate = graph.recipes.get(candidate.id)
  graph.recipes.set(candidate.id, candidate)
  const loop = findLoop(graph, candidate.id)
  if (hadCandidate) graph.recipes.set(candidate.id, hadCandidate)
  else graph.recipes.delete(candidate.id)
  if (loop) return { error: loopErrorMessage(loop), loopRecipeIds: loop.chainIds }
  return null
}
