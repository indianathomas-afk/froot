import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { ChefHat } from "lucide-react"
import Link from "next/link"
import { computeAllRecipeCosts, costPct, loadCostGraph, recipesUsing } from "@/lib/recipe-cost"
import { RecipesClient } from "./recipes-client"

export default async function RecipesPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <ChefHat className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Recipes & Costing</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Link menu items to ingredient quantities for theoretical costs — upgrade to the Inventory add-on to unlock this page.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Plan
          </Link>
        </div>
      </div>
    )
  }

  const dbUser = userId
    ? await prisma.user.findUnique({ where: { clerkUserId: userId }, include: { storeAssignments: true } })
    : null
  const isManager = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  const [salesItems, graph, stores] = await Promise.all([
    prisma.salesItem.findMany({
      where: { organizationId: org.id, isDeleted: false },
      include: { recipe: { select: { id: true } } },
      orderBy: [{ menuGroup: "asc" }, { name: "asc" }],
    }),
    loadCostGraph(org.id),
    prisma.store.findMany({
      where: {
        organizationId: org.id,
        isActive: true,
        ...(dbUser?.role === "ADMIN" ? {} : { id: { in: dbUser?.storeAssignments.map((a) => a.storeId) ?? [] } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])
  const costs = computeAllRecipeCosts(graph)

  const items = salesItems.map((s) => {
    const cost = s.recipe ? costs.get(s.recipe.id) : null
    return {
      id: s.id,
      displayName: s.displayName,
      menuGroup: s.menuGroup,
      priceCents: s.priceCents,
      recipeStatus: s.recipeStatus,
      recipeId: s.recipe?.id ?? null,
      cost: cost?.cost ?? null,
      costError: cost?.error ?? null,
      costPct: costPct(cost?.cost ?? null, s.priceCents),
    }
  })

  const prepRecipes = [...graph.recipes.values()]
    .filter((r) => r.salesItemId === null)
    .map((r) => {
      const cost = costs.get(r.id)
      const prepared = graph.preparedByRecipeId.get(r.id)
      return {
        id: r.id,
        name: r.name,
        yieldQty: r.yieldQty,
        yieldUnit: r.yieldUnit,
        isActive: r.isActive,
        cost: cost?.cost ?? null,
        costPerYieldUnit: cost?.costPerYieldUnit ?? null,
        costError: cost?.error ?? null,
        countable: !!prepared && prepared.isActive,
        usedInCount: recipesUsing(graph, r.id).size,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return <RecipesClient items={items} prepRecipes={prepRecipes} stores={stores} isManager={isManager} />
}
