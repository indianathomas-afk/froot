import { NextResponse } from "next/server"
import { requireNutrition } from "@/lib/nutrition-access"
import { NutritionUploadSchema, parseNutritionCsv, planNutritionForOrg, summarizeNutritionPlan } from "@/lib/nutrition-import"

// POST /api/nutrition/import/preview — { csv, fileName } → what an apply would
// write, row by row, with a status for each. Writes nothing; the file is not
// stored. ADMIN (nutrition.manage, N1-F3). N-1 deliverable 4.

export async function POST(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const parsed = NutritionUploadSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: "Upload a CSV file (2 MB max)" }, { status: 400 })

  const csv = parseNutritionCsv(parsed.data.csv)
  if (csv.error) return NextResponse.json({ error: csv.error }, { status: 400 })

  const plan = await planNutritionForOrg(ctx.org.id, csv)
  return NextResponse.json({ rows: plan, summary: summarizeNutritionPlan(plan) })
}
