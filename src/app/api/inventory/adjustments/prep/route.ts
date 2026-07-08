import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { adjustmentRouteContext, buildAdjustmentRow, canAccessStore } from "@/lib/adjustments"
import { expandRecipeToIngredients, loadCostGraph } from "@/lib/recipe-cost"

// Record a prep batch: pick a countable recipe, a batch multiplier, store and
// date → one PREP group + PREP_CONSUME rows (the recipe's line items, stopping
// at stocked prepared sub-items) + one PREP_PRODUCE row on the prepared
// ingredient (yieldQty × multiplier). Any assigned store user can record prep.
const PrepSchema = z.object({
  recipeId: z.string().min(1),
  storeId: z.string().min(1),
  multiplier: z.number().positive(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().optional().nullable(),
})

export async function POST(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope, dbUser } = ctx

  const body = await req.json()
  const data = PrepSchema.parse(body)

  if (!canAccessStore(scope, data.storeId)) {
    return NextResponse.json({ error: "No access to this store" }, { status: 403 })
  }

  const recipe = await prisma.recipe.findFirst({
    where: { id: data.recipeId, organizationId: org.id },
    include: { preparedIngredient: true },
  })
  if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 })
  if (!recipe.preparedIngredient || !recipe.preparedIngredient.isActive) {
    return NextResponse.json({ error: `"${recipe.name}" is not a countable prep recipe` }, { status: 422 })
  }

  const graph = await loadCostGraph(org.id)
  const consumed = expandRecipeToIngredients(graph, recipe.id, data.multiplier, "consumption")
  if (consumed === null) {
    return NextResponse.json(
      { error: `"${recipe.name}" has a loop or unit problem — fix the recipe before recording prep` },
      { status: 422 }
    )
  }

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: [...consumed.keys()] }, organizationId: org.id },
  })
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))
  const missing = [...consumed.keys()].filter((id) => !ingredientById.has(id))
  if (missing.length) {
    return NextResponse.json({ error: "An ingredient in this recipe no longer exists" }, { status: 422 })
  }

  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date()
  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.adjustmentGroup.create({
      data: {
        organizationId: org.id,
        type: "PREP",
        fromStoreId: data.storeId,
        recipeId: recipe.id,
        batchMultiplier: data.multiplier,
        occurredAt,
        note: data.note ?? null,
        createdByUserId: dbUser.id,
      },
    })
    await tx.inventoryAdjustment.createMany({
      data: [
        ...[...consumed.entries()].map(([ingredientId, qty]) =>
          buildAdjustmentRow({
            organizationId: org.id,
            storeId: data.storeId,
            ingredient: ingredientById.get(ingredientId)!,
            type: "PREP_CONSUME",
            quantity: qty,
            groupId: created.id,
            occurredAt,
            createdByUserId: dbUser.id,
          })
        ),
        buildAdjustmentRow({
          organizationId: org.id,
          storeId: data.storeId,
          ingredient: recipe.preparedIngredient!,
          type: "PREP_PRODUCE",
          quantity: recipe.yieldQty * data.multiplier,
          groupId: created.id,
          occurredAt,
          createdByUserId: dbUser.id,
        }),
      ],
    })
    return created
  })

  const full = await prisma.adjustmentGroup.findUnique({
    where: { id: group.id },
    include: { adjustments: true },
  })
  return NextResponse.json(full, { status: 201 })
}
