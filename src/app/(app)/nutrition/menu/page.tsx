import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { nutritionActive } from "@/lib/nutrition-access"
import { ingredientDisplayName } from "@/lib/nutrition"
import { computeAllRecipeNutrition, incompleteNutrients, loadNutritionGraph, rankBlockers } from "@/lib/recipe-nutrition"
import { itemVerification, type ProofState } from "@/lib/nutrition-proof"
import { NutritionUpgradeCard } from "../upgrade-card"
import { MenuNutritionClient, type MenuItemRow, type BlockerRow } from "./menu-nutrition-client"

// N-1 deliverable 6: every Square sales item that has a recipe, with its
// computed calories, key nutrients, allergens and completeness, plus the
// ingredients blocking completeness ranked by how many items each blocks.
// Read-only; no FDA rounding (that is N-2). nutrition.view = ADMIN, MANAGER,
// STORE (F3); both modules required (R-4).
//
// N-1b deliverable 6: an item is Verified only when every food ingredient it
// reaches is VERIFIED and not stale; items with no food ingredients are left
// out of "N of M items verified" (Gary, F8). The "To fix" list gains a "not
// verified" reason, ranked the same way.
export default async function MenuNutritionPage() {
  let current
  try {
    current = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  if (!nutritionActive(current.org)) return <NutritionUpgradeCard />
  if (!current.dbUser || !can(current.actor, "nutrition.view")) redirect("/dashboard")

  const [salesItems, graph] = await Promise.all([
    prisma.salesItem.findMany({
      where: { organizationId: current.org.id, isDeleted: false },
      select: { id: true, displayName: true, menuGroup: true, recipeStatus: true, recipe: { select: { id: true } } },
      orderBy: [{ menuGroup: "asc" }, { displayName: "asc" }],
    }),
    loadNutritionGraph(current.org.id),
  ])
  const results = computeAllRecipeNutrition(graph)
  const proofOf = (id: string): ProofState => graph.ingredients.get(id)?.proof ?? "NONE"

  const withRecipe = salesItems.filter((s) => s.recipe && results.has(s.recipe.id))
  const items: MenuItemRow[] = withRecipe.map((s) => {
    const n = results.get(s.recipe!.id)!
    const food = n.foodIngredientIds.size
    const foodIds = [...n.foodIngredientIds]
    return {
      salesItemId: s.id,
      recipeId: s.recipe!.id,
      name: s.displayName,
      menuGroup: s.menuGroup,
      totals: n.totals,
      allergens: n.allergens,
      foodIngredientCount: food,
      withNutritionCount: food - n.missingIngredientIds.size,
      incompleteNutrients: incompleteNutrients(n),
      complete: n.complete,
      error: n.error,
      verification: itemVerification(n, proofOf),
      verifiedIngredientCount: foodIds.filter((id) => proofOf(id) === "VERIFIED").length,
      staleIngredientCount: foodIds.filter((id) => proofOf(id) === "STALE").length,
    }
  })

  // Ranked over the items shown — a blocker that only affects prep recipes
  // nobody sells is not on this list.
  const blockers: BlockerRow[] = rankBlockers(withRecipe.map((s) => results.get(s.recipe!.id)!), proofOf).map((b) => {
    const ing = graph.ingredients.get(b.ingredientId)
    return { ...b, name: ing ? ingredientDisplayName(ing) : "Unknown ingredient" }
  })

  return (
    <MenuNutritionClient
      items={items}
      blockers={blockers}
      withoutRecipeCount={salesItems.filter((s) => !s.recipe && s.recipeStatus !== "NON_RECIPE").length}
      canManage={can(current.actor, "nutrition.manage")}
    />
  )
}
