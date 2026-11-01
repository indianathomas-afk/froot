import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { ALLERGENS, NUTRIENT_KEYS, nutritionInputError, sortAllergens, type NutrientValues } from "@/lib/nutrition"

// GET /api/nutrition/ingredients/[id] — one ingredient's nutrition record,
// allergens and not-food flag (nutrition.view). PUT replaces all three
// (nutrition.manage — ADMIN, N1-F3). `nutrition: null` removes the record.
// Writes never touch the Ingredient's other fields, so this route is separate
// from the inventory PATCH, which MANAGER may call. N-1.

const nutrientSchema = z.number().nonnegative().nullable()

const PutSchema = z.object({
  nutrition: z
    .object({
      basisAmount: z.number().positive(),
      basisUnit: z.string().min(1),
      values: z.object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nutrientSchema])) as Record<keyof NutrientValues, typeof nutrientSchema>),
      sourceNote: z.string().max(500).nullable(),
    })
    .nullable(),
  allergens: z.array(z.enum(ALLERGENS.map((a) => a.value) as [string, ...string[]])),
  nutritionExempt: z.boolean(),
})

const SELECT = {
  id: true,
  name: true,
  brand: true,
  kind: true,
  reportingUnit: true,
  nutritionExempt: true,
  allergens: true,
  nutrition: true,
} as const

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.view")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const ing = await prisma.ingredient.findFirst({ where: { id, organizationId: ctx.org.id, deletedAt: null }, select: SELECT })
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(ing)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const parsed = PutSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 })
  const data = parsed.data

  const ing = await prisma.ingredient.findFirst({ where: { id, organizationId: ctx.org.id, deletedAt: null } })
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (ing.kind === "PREPARED" && data.nutrition) {
    return NextResponse.json({ error: "A prepared ingredient's nutrition is computed from its recipe" }, { status: 400 })
  }
  if (data.nutrition) {
    const err = nutritionInputError(data.nutrition, ing.reportingUnit)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const allergens = sortAllergens(data.allergens as (typeof ALLERGENS)[number]["value"][])
  const updated = await prisma.$transaction(async (tx) => {
    await tx.ingredient.update({
      where: { id: ing.id },
      data: { allergens, nutritionExempt: data.nutritionExempt },
    })
    if (data.nutrition) {
      const row = {
        basisAmount: data.nutrition.basisAmount,
        basisUnit: data.nutrition.basisUnit,
        ...data.nutrition.values,
        sourceNote: data.nutrition.sourceNote?.trim() || null,
        updatedByUserId: ctx.dbUser?.id ?? null,
      }
      await tx.ingredientNutrition.upsert({ where: { ingredientId: ing.id }, create: { ingredientId: ing.id, ...row }, update: row })
    } else {
      await tx.ingredientNutrition.deleteMany({ where: { ingredientId: ing.id } })
    }
    return tx.ingredient.findUniqueOrThrow({ where: { id: ing.id }, select: SELECT })
  })
  return NextResponse.json(updated)
}
