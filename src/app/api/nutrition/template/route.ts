import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { buildNutritionTemplate, storedNutritionInput } from "@/lib/nutrition-import"

// GET /api/nutrition/template — the org's ingredients as a nutrition import
// file, pre-filled with what is stored, so an unedited file imports back as
// zero changes (Gary, 2026-11-01). Reads only. ADMIN (nutrition.manage — the
// same gate as the import it feeds, N1-F3). N-1a.

export async function GET() {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const ingredients = await prisma.ingredient.findMany({
    where: { organizationId: ctx.org.id, deletedAt: null },
    select: {
      id: true, name: true, brand: true, reportingUnit: true, kind: true, isActive: true, isArchived: true,
      allergens: true, nutritionExempt: true, nutrition: true, category: { select: { name: true } },
    },
  })
  const csv = buildNutritionTemplate(
    ingredients.map((i) => ({ ...i, category: i.category?.name ?? null, nutrition: storedNutritionInput(i.nutrition) }))
  )

  // en-CA formats as YYYY-MM-DD; the org's own calendar day.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.org.timezone }).format(new Date())
  const slug = (ctx.org.slug ?? "org").replace(/[^a-zA-Z0-9-]+/g, "-")
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="froot-nutrition-template-${slug}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
