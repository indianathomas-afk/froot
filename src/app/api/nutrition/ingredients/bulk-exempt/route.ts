import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"

// POST /api/nutrition/ingredients/bulk-exempt — mark (or unmark) ingredients
// as not-food. F2 (Gary, 2026-11-01): "A nutritionExempt boolean on
// Ingredient, with its own ADMIN bulk route." Its own route because the
// inventory bulk route admits MANAGER. Org-scoped: ids from another org are
// ignored, never touched. N-1.

const Schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  exempt: z.boolean(),
})

export async function POST(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const parsed = Schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: "Expected { ids: string[], exempt: boolean }" }, { status: 400 })

  const result = await prisma.ingredient.updateMany({
    where: { id: { in: parsed.data.ids }, organizationId: ctx.org.id, deletedAt: null },
    data: { nutritionExempt: parsed.data.exempt },
  })
  return NextResponse.json({ updated: result.count })
}
