import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { RESET_TO_ESTIMATED, verifyRefusal } from "@/lib/nutrition-proof"
import { findOrgIngredient, nutritionAudit, serializeIngredient } from "@/lib/nutrition-record"

// POST /api/nutrition/ingredients/[id]/verify — { verified: true } marks the
// record VERIFIED now; { verified: false } returns it to ESTIMATED. ADMIN
// (nutrition.manage). The one place VERIFIED is ever set — the import never
// does (Gary, F2: "Verified needs a label document or a source link, set by
// ADMIN only."). Verifying an already-verified record restarts its 12-month
// window (F4), which is how "Re-check label" is cleared. N-1b.

const Schema = z.object({ verified: z.boolean() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Expected { verified: boolean }" }, { status: 400 })

  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const n = ing.nutrition

  if (parsed.data.verified) {
    const refusal = verifyRefusal(ing, n)
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })
    await prisma.$transaction(async (tx) => {
      await tx.ingredientNutrition.update({
        where: { ingredientId: ing.id },
        data: { status: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: ctx.dbUser?.id ?? null },
      })
      await nutritionAudit(tx, ctx, "nutrition.verified", ing.id, {
        sourceUrl: n!.sourceUrl,
        labelFileName: n!.labelFileName,
        labelFileHash: n!.labelFileHash,
        previousStatus: n!.status,
        previousVerifiedAt: n!.verifiedAt?.toISOString() ?? null,
      })
    })
  } else if (n?.status === "VERIFIED") {
    await prisma.$transaction(async (tx) => {
      await tx.ingredientNutrition.update({ where: { ingredientId: ing.id }, data: RESET_TO_ESTIMATED })
      await nutritionAudit(tx, ctx, "nutrition.unverified", ing.id, {
        verifiedAt: n.verifiedAt?.toISOString() ?? null,
        verifiedByUserId: n.verifiedByUserId,
      })
    })
  }

  const updated = await findOrgIngredient(ctx.org.id, ing.id)
  return NextResponse.json(await serializeIngredient(updated!, ctx.org.id))
}
