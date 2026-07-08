import { z } from "zod"
import { compatibleUnits } from "@/lib/units"
import { findLoop, loopErrorMessage, type CostGraph, type GraphRecipe } from "@/lib/recipe-cost"

// ─── Shared request validation for the recipes API (Phase I-6) ───────────────

export const RecipeLineSchema = z
  .object({
    ingredientId: z.string().optional().nullable(),
    subRecipeId: z.string().optional().nullable(),
    amount: z.number().positive(),
    unit: z.string().min(1),
  })
  .refine((l) => !!l.ingredientId !== !!l.subRecipeId, {
    message: "Each line needs exactly one of an ingredient or a sub-recipe",
  })

export const RecipeSchema = z.object({
  name: z.string().min(1),
  salesItemId: z.string().optional().nullable(),
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
  const lineErrors: { index: number; error: string }[] = []
  candidate.lines.forEach((line, index) => {
    if (line.subRecipeId) {
      const sub = graph.recipes.get(line.subRecipeId)
      if (!sub) return void lineErrors.push({ index, error: "Sub-recipe not found" })
      if (sub.id === candidate.id) return void lineErrors.push({ index, error: "A recipe can't contain itself" })
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
  if (lineErrors.length) return { error: "Some lines have unit problems", lineErrors }

  const hadCandidate = graph.recipes.get(candidate.id)
  graph.recipes.set(candidate.id, candidate)
  const loop = findLoop(graph, candidate.id)
  if (hadCandidate) graph.recipes.set(candidate.id, hadCandidate)
  else graph.recipes.delete(candidate.id)
  if (loop) return { error: loopErrorMessage(loop), loopRecipeIds: loop.chainIds }
  return null
}
