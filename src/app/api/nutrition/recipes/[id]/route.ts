import { NextResponse } from "next/server"
import { requireNutrition } from "@/lib/nutrition-access"
import { computeRecipeNutrition, loadNutritionGraph } from "@/lib/recipe-nutrition"
import { ingredientDisplayName } from "@/lib/nutrition"

// GET /api/nutrition/recipes/[id] — one recipe's full computed breakdown for
// the Menu Nutrition detail view: totals, allergens, completeness and each
// line's contribution. Computed on request from the whole graph (N-1 audit G:
// compute on request, no cache). nutrition.view (ADMIN/MANAGER/STORE). N-1.

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.view")
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const graph = await loadNutritionGraph(ctx.org.id)
  const recipe = graph.recipes.get(id)
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const n = computeRecipeNutrition(graph, id)
  const nameOf = (ingredientId: string) => {
    const ing = graph.ingredients.get(ingredientId)
    return ing ? ingredientDisplayName(ing) : "Unknown ingredient"
  }

  return NextResponse.json({
    id: recipe.id,
    name: recipe.name,
    totals: n.totals,
    allergens: n.allergens,
    complete: n.complete,
    error: n.error,
    foodIngredientCount: n.foodIngredientIds.size,
    missingIngredients: [...n.missingIngredientIds].map(nameOf).sort(),
    partialIngredients: [...n.partialIngredients].map(([ingId, keys]) => ({ name: nameOf(ingId), missing: keys })),
    lines: recipe.lines.map((line, i) => {
      const r = n.lines[i]
      const sub = line.subRecipeId ? graph.recipes.get(line.subRecipeId) : null
      const ing = line.ingredientId ? graph.ingredients.get(line.ingredientId) : null
      return {
        id: line.id,
        name: sub ? sub.name : ing ? ingredientDisplayName(ing) : "Unknown",
        kind: sub ? "sub" : ing?.preparedFromRecipeId ? "prepared" : "ingredient",
        amount: line.amount,
        unit: line.unit,
        status: r?.status ?? "error",
        error: r?.error ?? null,
        contribution: r?.contribution ?? null,
      }
    }),
  })
}
