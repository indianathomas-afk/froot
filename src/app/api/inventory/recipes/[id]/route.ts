import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"
import {
  loadCostGraph,
  computeRecipeCost,
  costPct,
  recipesUsing,
  recomputePreparedIngredientCosts,
} from "@/lib/recipe-cost"
import { RecipeSchema, candidateFromInput, validateRecipeLines } from "@/lib/recipe-api"

const PatchSchema = RecipeSchema.partial().extend({
  // Marking a sub-recipe countable creates (or reactivates) its linked PREPARED
  // ingredient; unmarking deactivates it (never deletes — counts reference it).
  countable: z.boolean().optional(),
})

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const { id } = await params
  const recipe = await prisma.recipe.findFirst({
    where: { id, organizationId: org.id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      salesItem: { select: { id: true, displayName: true, priceCents: true, menuGroup: true } },
      preparedIngredient: { select: { id: true, name: true, isActive: true } },
    },
  })
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const graph = await loadCostGraph(org.id)
  const cost = computeRecipeCost(graph, id)
  const usedInIds = recipesUsing(graph, id)
  const usedIn = [...usedInIds].map((rid) => {
    const r = graph.recipes.get(rid)
    return { id: rid, name: r?.name ?? "Unknown", salesItemId: r?.salesItemId ?? null }
  })

  return NextResponse.json({
    ...recipe,
    cost: cost.cost,
    costPerYieldUnit: cost.costPerYieldUnit,
    costError: cost.error,
    loopRecipeIds: cost.loop?.chainIds ?? null,
    lineCosts: cost.lines,
    costPct: costPct(cost.cost, recipe.salesItem?.priceCents),
    usedIn,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const existing = await prisma.recipe.findFirst({
    where: { id, organizationId: org.id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, preparedIngredient: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const data = PatchSchema.parse(body)

  const salesItemId = data.salesItemId !== undefined ? data.salesItemId : existing.salesItemId
  if (salesItemId && salesItemId !== existing.salesItemId) {
    const salesItem = await prisma.salesItem.findFirst({
      where: { id: salesItemId, organizationId: org.id },
      include: { recipe: true },
    })
    if (!salesItem) return NextResponse.json({ error: "Sales item not found" }, { status: 404 })
    if (salesItem.recipe && salesItem.recipe.id !== id) {
      return NextResponse.json({ error: "This sales item already has a recipe" }, { status: 409 })
    }
  }

  const graph = await loadCostGraph(org.id)
  const merged = {
    name: data.name ?? existing.name,
    salesItemId,
    yieldQty: data.yieldQty ?? existing.yieldQty,
    yieldUnit: data.yieldUnit ?? existing.yieldUnit,
    servingSizeQty: data.servingSizeQty !== undefined ? data.servingSizeQty : existing.servingSizeQty,
    servingSizeUnit: data.servingSizeUnit !== undefined ? data.servingSizeUnit : existing.servingSizeUnit,
    isActive: data.isActive ?? existing.isActive,
    lines:
      data.lines?.map((l) => ({
        ingredientId: l.ingredientId ?? null,
        subRecipeId: l.subRecipeId ?? null,
        amount: l.amount,
        unit: l.unit,
      })) ?? existing.lines,
  }
  const validation = validateRecipeLines(graph, candidateFromInput(id, merged))
  if (validation) return NextResponse.json(validation, { status: 422 })

  // Count dependents BEFORE saving so the toast can say how many recipe costs
  // this edit propagates to.
  const affectedRecipeCount = recipesUsing(graph, id).size

  await prisma.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id },
      data: {
        name: merged.name,
        salesItemId: merged.salesItemId,
        yieldQty: merged.yieldQty,
        yieldUnit: merged.yieldUnit,
        servingSizeQty: merged.servingSizeQty,
        servingSizeUnit: merged.servingSizeUnit,
        isActive: merged.isActive,
      },
    })
    if (data.lines) {
      await tx.recipeLine.deleteMany({ where: { recipeId: id } })
      await tx.recipeLine.createMany({
        data: data.lines.map((l, i) => ({
          recipeId: id,
          ingredientId: l.ingredientId ?? null,
          subRecipeId: l.subRecipeId ?? null,
          amount: l.amount,
          unit: l.unit,
          sortOrder: i,
        })),
      })
    }
    // Keep recipeStatus in sync when the recipe moves between variations.
    if (existing.salesItemId && existing.salesItemId !== merged.salesItemId) {
      await tx.salesItem.update({ where: { id: existing.salesItemId }, data: { recipeStatus: "UNMAPPED" } })
    }
    if (merged.salesItemId && existing.salesItemId !== merged.salesItemId) {
      await tx.salesItem.update({ where: { id: merged.salesItemId }, data: { recipeStatus: "MAPPED" } })
    }
  })

  // Countable toggle → PREPARED ingredient lifecycle.
  if (data.countable === true && merged.salesItemId === null) {
    if (existing.preparedIngredient) {
      await prisma.ingredient.update({ where: { id: existing.preparedIngredient.id }, data: { isActive: true, isArchived: false } })
    } else {
      const freshGraph = await loadCostGraph(org.id)
      const cost = computeRecipeCost(freshGraph, id)
      await prisma.ingredient.create({
        data: {
          organizationId: org.id,
          name: merged.name,
          kind: "PREPARED",
          preparedFromRecipeId: id,
          purchaseUnitLabel: "batch",
          packDescription: `${merged.yieldQty} ${merged.yieldUnit} per batch`,
          purchaseCost: cost.cost ?? 0,
          reportingUnit: merged.yieldUnit,
          unitsPerPurchase: merged.yieldQty,
          costPerReportingUnit: cost.costPerYieldUnit ?? 0,
          costLogs: { create: { costPerReportingUnit: cost.costPerYieldUnit ?? 0, source: "PREP_RECOMPUTE" } },
        },
      })
    }
  } else if (data.countable === false && existing.preparedIngredient) {
    await prisma.ingredient.update({ where: { id: existing.preparedIngredient.id }, data: { isActive: false } })
  }

  // Propagate: this recipe may feed prepared ingredients (including its own).
  await recomputePreparedIngredientCosts(org.id)

  const graph2 = await loadCostGraph(org.id)
  const cost = computeRecipeCost(graph2, id)
  const updated = await prisma.recipe.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      salesItem: { select: { id: true, displayName: true, priceCents: true, menuGroup: true } },
      preparedIngredient: { select: { id: true, name: true, isActive: true } },
    },
  })

  return NextResponse.json({
    ...updated,
    cost: cost.cost,
    costPerYieldUnit: cost.costPerYieldUnit,
    costError: cost.error,
    loopRecipeIds: cost.loop?.chainIds ?? null,
    lineCosts: cost.lines,
    costPct: costPct(cost.cost, updated?.salesItem?.priceCents),
    affectedRecipeCount,
  })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const recipe = await prisma.recipe.findFirst({
    where: { id, organizationId: org.id },
    include: { usedIn: { select: { recipe: { select: { id: true, name: true } } } }, preparedIngredient: true },
  })
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (recipe.usedIn.length > 0) {
    const names = [...new Set(recipe.usedIn.map((l) => l.recipe.name))]
    return NextResponse.json(
      { error: `This recipe is used in: ${names.join(", ")}. Remove those lines first.` },
      { status: 409 }
    )
  }
  if (recipe.preparedIngredient) {
    return NextResponse.json(
      { error: `"${recipe.preparedIngredient.name}" is a countable prepared item linked to this recipe. Unmark it as countable first.` },
      { status: 409 }
    )
  }

  await prisma.$transaction(async (tx) => {
    if (recipe.salesItemId) {
      await tx.salesItem.update({ where: { id: recipe.salesItemId }, data: { recipeStatus: "UNMAPPED" } })
    }
    await tx.recipe.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}
