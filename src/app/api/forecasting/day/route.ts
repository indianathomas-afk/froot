import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { refreshPlanTotals, round2 } from "@/lib/goal-engine"
import { dbDate } from "@/lib/reports"

const DaySchema = z.object({
  storeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goalAmount: z.number().min(0),
})

// PATCH /api/forecasting/day — set one day's goal (admin). Marks the row as an
// override so % recalculations preserve it.
export async function PATCH(req: Request) {
  const ctx = await requireForecastContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = DaySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { storeId, date, goalAmount } = parsed.data

  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  const existing = await prisma.dailyGoal.findUnique({ where: { storeId_date: { storeId, date: dbDate(date) } } })
  if (!existing) {
    return NextResponse.json(
      { error: "No goal plan covers this date — create the year's plan first." },
      { status: 404 }
    )
  }

  const plan = await prisma.$transaction(async (tx) => {
    await tx.dailyGoal.update({
      where: { id: existing.id },
      data: { goalAmount: round2(goalAmount), isOverride: true },
    })
    return refreshPlanTotals(tx, existing.planId)
  })

  return NextResponse.json({
    day: { date, goalAmount: round2(goalAmount), isOverride: true },
    goalTotal: plan.goalTotal,
  })
}
