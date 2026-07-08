import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import { computeAllRecipeCosts, loadCostGraph, recipesUsing } from "@/lib/recipe-cost"
import { RecipeEditorClient } from "./recipe-editor-client"

// Editor for one recipe; id === "new" creates (optionally pre-attached to
// ?salesItemId= from the triage queue).
export default async function RecipeEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ salesItemId?: string }>
}) {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")
  if (!org.activeModules.includes("inventory")) redirect("/inventory/recipes")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const isManager = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  const { id } = await params
  const { salesItemId: prefillSalesItemId } = await searchParams
  const isNew = id === "new"

  const [graph, ingredients, attachableSalesItems] = await Promise.all([
    loadCostGraph(org.id),
    prisma.ingredient.findMany({
      where: { organizationId: org.id, deletedAt: null, isArchived: false, isActive: true },
      select: {
        id: true,
        brand: true,
        name: true,
        reportingUnit: true,
        costPerReportingUnit: true,
        kind: true,
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Items a recipe could attach or duplicate to (no recipe yet).
    prisma.salesItem.findMany({
      where: { organizationId: org.id, isDeleted: false, recipe: null },
      select: { id: true, displayName: true, menuGroup: true, priceCents: true },
      orderBy: [{ menuGroup: "asc" }, { name: "asc" }],
    }),
  ])
  const costs = computeAllRecipeCosts(graph)

  const recipe = isNew
    ? null
    : await prisma.recipe.findFirst({
        where: { id, organizationId: org.id },
        include: {
          lines: { orderBy: { sortOrder: "asc" } },
          salesItem: { select: { id: true, displayName: true, priceCents: true, menuGroup: true } },
          preparedIngredient: { select: { id: true, name: true, isActive: true } },
        },
      })
  if (!isNew && !recipe) notFound()

  const prefillSalesItem = prefillSalesItemId
    ? await prisma.salesItem.findFirst({
        where: { id: prefillSalesItemId, organizationId: org.id },
        select: { id: true, displayName: true, priceCents: true, menuGroup: true },
      })
    : null

  // Sub-recipe options for the typeahead (any recipe except this one; prep
  // recipes first), with computed unit costs for live line pricing.
  const subRecipeOptions = [...graph.recipes.values()]
    .filter((r) => r.id !== id && r.isActive)
    .map((r) => ({
      id: r.id,
      name: r.name,
      isPrep: r.salesItemId === null,
      yieldQty: r.yieldQty,
      yieldUnit: r.yieldUnit,
      servingSizeQty: r.servingSizeQty,
      servingSizeUnit: r.servingSizeUnit,
      costPerYieldUnit: costs.get(r.id)?.costPerYieldUnit ?? null,
    }))
    .sort((a, b) => (a.isPrep === b.isPrep ? a.name.localeCompare(b.name) : a.isPrep ? -1 : 1))

  const usedIn = recipe
    ? [...recipesUsing(graph, recipe.id)].map((rid) => ({
        id: rid,
        name: graph.recipes.get(rid)?.name ?? "Unknown",
      }))
    : []

  return (
    <RecipeEditorClient
      isManager={isManager}
      recipe={
        recipe
          ? {
              id: recipe.id,
              name: recipe.name,
              salesItem: recipe.salesItem,
              yieldQty: recipe.yieldQty,
              yieldUnit: recipe.yieldUnit,
              servingSizeQty: recipe.servingSizeQty,
              servingSizeUnit: recipe.servingSizeUnit,
              isActive: recipe.isActive,
              countable: !!recipe.preparedIngredient && recipe.preparedIngredient.isActive,
              lines: recipe.lines.map((l) => ({
                ingredientId: l.ingredientId,
                subRecipeId: l.subRecipeId,
                amount: l.amount,
                unit: l.unit,
              })),
            }
          : null
      }
      prefillSalesItem={prefillSalesItem}
      ingredients={ingredients.map((i) => ({
        id: i.id,
        displayName: i.brand ? `${i.brand} ${i.name}` : i.name,
        categoryName: i.category?.name ?? null,
        reportingUnit: i.reportingUnit,
        costPerReportingUnit: i.costPerReportingUnit,
        isPrepared: i.kind === "PREPARED",
      }))}
      subRecipes={subRecipeOptions}
      attachableSalesItems={attachableSalesItems}
      usedIn={usedIn}
    />
  )
}
