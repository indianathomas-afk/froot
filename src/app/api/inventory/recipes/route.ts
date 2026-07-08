import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"
import { loadCostGraph, computeAllRecipeCosts, costPct, recipesUsing } from "@/lib/recipe-cost"
import { RecipeSchema, candidateFromInput, validateRecipeLines } from "@/lib/recipe-api"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const [graph, recipes] = await Promise.all([
    loadCostGraph(org.id),
    prisma.recipe.findMany({
      where: { organizationId: org.id },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        salesItem: { select: { id: true, displayName: true, priceCents: true, menuGroup: true } },
        preparedIngredient: { select: { id: true, name: true, isActive: true } },
      },
      orderBy: { name: "asc" },
    }),
  ])
  const costs = computeAllRecipeCosts(graph)

  return NextResponse.json(
    recipes.map((r) => {
      const c = costs.get(r.id)
      return {
        ...r,
        cost: c?.cost ?? null,
        costPerYieldUnit: c?.costPerYieldUnit ?? null,
        costError: c?.error ?? null,
        loopRecipeIds: c?.loop?.chainIds ?? null,
        lineCosts: c?.lines ?? [],
        costPct: costPct(c?.cost ?? null, r.salesItem?.priceCents),
        usedInCount: recipesUsing(graph, r.id).size,
      }
    })
  )
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const body = await req.json()
  const data = RecipeSchema.parse(body)

  if (data.salesItemId) {
    const salesItem = await prisma.salesItem.findFirst({
      where: { id: data.salesItemId, organizationId: org.id },
      include: { recipe: true },
    })
    if (!salesItem) return NextResponse.json({ error: "Sales item not found" }, { status: 404 })
    if (salesItem.recipe) {
      return NextResponse.json({ error: "This sales item already has a recipe" }, { status: 409 })
    }
  }

  const graph = await loadCostGraph(org.id)
  const validation = validateRecipeLines(graph, candidateFromInput("__candidate__", data))
  if (validation) return NextResponse.json(validation, { status: 422 })

  const recipe = await prisma.$transaction(async (tx) => {
    const created = await tx.recipe.create({
      data: {
        organizationId: org.id,
        name: data.name,
        salesItemId: data.salesItemId ?? null,
        yieldQty: data.yieldQty,
        yieldUnit: data.yieldUnit,
        servingSizeQty: data.servingSizeQty ?? null,
        servingSizeUnit: data.servingSizeUnit ?? null,
        isActive: data.isActive ?? true,
        lines: {
          create: data.lines.map((l, i) => ({
            ingredientId: l.ingredientId ?? null,
            subRecipeId: l.subRecipeId ?? null,
            amount: l.amount,
            unit: l.unit,
            sortOrder: i,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    })
    if (data.salesItemId) {
      await tx.salesItem.update({ where: { id: data.salesItemId }, data: { recipeStatus: "MAPPED" } })
    }
    return created
  })

  return NextResponse.json(recipe, { status: 201 })
}
