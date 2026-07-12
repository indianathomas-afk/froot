import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { redistributeMonth, round2 } from "@/lib/goal-engine"
import { dbDate } from "@/lib/reports"
import { daysInMonth } from "@/lib/pacing"
import { writeAuditLog } from "@/lib/audit"

const MonthSchema = z.object({
  storeId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  totalAmount: z.number().min(0),
})

// PATCH /api/forecasting/month — set a month's total (admin). The total is
// redistributed across the month's days by basis weight (LY weekday shape),
// and every day is marked as an override.
export async function PATCH(req: Request) {
  const ctx = await requireForecastContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = MonthSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { storeId, month, totalAmount } = parsed.data

  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  const year = Number(month.slice(0, 4))
  const plan = await prisma.goalPlan.findUnique({ where: { storeId_year: { storeId, year } } })
  if (!plan) {
    return NextResponse.json({ error: "No goal plan for this year — create it first." }, { status: 404 })
  }

  // Capture the month's total before the redistribute for the audit trail.
  const monthEnd = `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, "0")}`
  const beforeAgg = await prisma.dailyGoal.aggregate({
    where: { storeId, date: { gte: dbDate(`${month}-01`), lte: dbDate(monthEnd) } },
    _sum: { goalAmount: true },
  })

  try {
    const updated = await redistributeMonth(plan.id, storeId, month, totalAmount)
    await writeAuditLog({
      organizationId: ctx.org.id,
      userId: ctx.userId,
      action: "goal.month_redistribute",
      entityType: "goal_plan",
      entityId: plan.id,
      metadata: {
        storeId,
        storeName: store.name,
        period: month,
        before: round2(beforeAgg._sum.goalAmount ?? 0),
        after: round2(totalAmount),
        source: "month",
      },
    })
    return NextResponse.json({ month, totalAmount, goalTotal: updated.goalTotal })
  } catch (e) {
    if (e instanceof Error && e.message === "NO_DAYS_IN_MONTH") {
      return NextResponse.json({ error: "No days found for that month." }, { status: 404 })
    }
    throw e
  }
}
