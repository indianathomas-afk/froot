import { NextResponse } from "next/server"
import { z } from "zod"
import { requireNutrition } from "@/lib/nutrition-access"
import { NutritionFileError, getLabelUploadUrl, labelKeyPrefix } from "@/lib/nutrition-files"
import { findOrgIngredient } from "@/lib/nutrition-record"

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

// POST /api/nutrition/ingredients/[id]/label/upload-url — first leg of the
// private browser upload (the HR-3 pattern): a presigned PUT straight to the
// froot-nutrition store under this ingredient's folder. ADMIN
// (nutrition.manage). F6 (Gary): "Proof controls stay disabled until nutrition
// exists" — so no URL is minted for an ingredient without a record. N-1b.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!ing.nutrition) return NextResponse.json({ error: "Save nutrition before adding a label document" }, { status: 409 })
  if (ing.nutritionExempt) return NextResponse.json({ error: "Not-food items carry no nutrition label" }, { status: 409 })

  try {
    const { pathname, uploadUrl } = await getLabelUploadUrl({
      keyPrefix: labelKeyPrefix(ctx.org.id, ing.id),
      ...parsed.data,
    })
    return NextResponse.json({ pathname, uploadUrl })
  } catch (err) {
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
