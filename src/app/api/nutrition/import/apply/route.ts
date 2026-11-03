import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import {
  APPLYABLE, NutritionUploadSchema, parseNutritionCsv, planNutritionForOrg, summarizeNutritionPlan,
} from "@/lib/nutrition-import"
import { RESET_TO_ESTIMATED } from "@/lib/nutrition-proof"
import { invalidatePublicMenu } from "@/lib/public-menu-data"

// POST /api/nutrition/import/apply — { csv, fileName }. RE-PLANS from the
// uploaded text (never trusts a client-sent plan) and writes the NEW / UPDATE /
// DETAILS_ONLY / NOT_FOOD rows in one transaction; every other row is reported,
// not written. Never creates ingredients. An UPDATE replaces the whole record: a
// blank nutrient cell becomes unknown. Each part (nutrition, allergens, the
// not-food flag) is written only where the file differs from what is stored;
// an unedited template writes nothing and logs no audit row (N-1a). The audit row is written inside the same
// transaction (the BEV-1 F9 shape). ADMIN (nutrition.manage, N1-F3). N-1.

export const maxDuration = 60

export async function POST(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const parsed = NutritionUploadSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: "Upload a CSV file (2 MB max)" }, { status: 400 })

  const csv = parseNutritionCsv(parsed.data.csv)
  if (csv.error) return NextResponse.json({ error: csv.error }, { status: 400 })

  const plan = await planNutritionForOrg(ctx.org.id, csv)
  const summary = summarizeNutritionPlan(plan)
  const toWrite = plan.filter((p) => APPLYABLE.has(p.status) && p.write && p.ingredientId)
  if (toWrite.length === 0) return NextResponse.json({ applied: 0, rows: plan, summary })

  const userId = ctx.dbUser?.id ?? null
  await prisma.$transaction(
    async (tx) => {
      for (const p of toWrite) {
        const ingredientId = p.ingredientId!
        const w = p.write!
        const ingData = {
          ...(w.allergens !== null && { allergens: w.allergens }),
          ...(w.nutritionExempt !== null && { nutritionExempt: w.nutritionExempt }),
        }
        if (Object.keys(ingData).length > 0) {
          await tx.ingredient.update({ where: { id: ingredientId }, data: ingData })
        }
        // N-1b: the link and the reset ride with the record. The import never
        // writes VERIFIED — only RESET_TO_ESTIMATED (F2, F3).
        const proof = {
          ...(w.sourceUrl && { sourceUrl: w.sourceUrl.url }),
          ...(w.resetStatus && RESET_TO_ESTIMATED),
        }
        if (w.nutrition) {
          const row = {
            basisAmount: w.nutrition.basisAmount,
            basisUnit: w.nutrition.basisUnit,
            ...w.nutrition.values,
            sourceNote: w.nutrition.sourceNote,
            ...proof,
            updatedByUserId: userId,
          }
          await tx.ingredientNutrition.upsert({ where: { ingredientId }, create: { ingredientId, ...row }, update: row })
        } else if (Object.keys(proof).length > 0) {
          // DETAILS_ONLY / NOT_FOOD: the record exists (the planner refuses a
          // link without one), so this touches exactly that row.
          await tx.ingredientNutrition.updateMany({ where: { ingredientId }, data: proof })
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: ctx.org.id,
          userId: ctx.dbUser?.clerkUserId ?? null,
          action: "nutrition.import.applied",
          entityType: "Import",
          metadata: {
            fileName: parsed.data.fileName ?? null,
            fileSize: parsed.data.csv.length,
            ingredientIds: toWrite.map((p) => p.ingredientId),
            // N-1b: which VERIFIED records this import sent back to ESTIMATED.
            statusResetIngredientIds: toWrite.filter((p) => p.write!.resetStatus).map((p) => p.ingredientId),
            summary,
          },
        },
      })
    },
    { timeout: 30_000 }
  )

  invalidatePublicMenu(ctx.org.id) // N-3: the public menu shows this; stale-while-revalidate (R-3)
  return NextResponse.json({ applied: toWrite.length, rows: plan, summary })
}
