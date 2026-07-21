import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import { round2 } from "@/lib/pacing"
import { mondayOfWeekStr } from "@/lib/labor-week"

export type WeeklyForecast = { total: number; source: "MANUAL" | "TREND" }

// The week's total projected sales for the labor budget (Phase 2). A MANUAL
// SalesForecast row (operator override) wins; otherwise sum the Forecasting
// module's DailyGoal for Mon–Sun (TREND) — same aggregate pattern as
// month-goal.ts. Returns null when neither exists → the Budget card shows its
// empty state. `anyDateInWeek` is a store-local yyyy-mm-dd; it snaps to Monday.
// Total sales only: delivery is already in Square net sales (goalAmount).
export async function getWeeklyForecast(storeId: string, anyDateInWeek: string): Promise<WeeklyForecast | null> {
  const weekStartStr = mondayOfWeekStr(anyDateInWeek)
  const weekStart = new Date(`${weekStartStr}T00:00:00.000Z`)

  const manual = await prisma.salesForecast.findUnique({
    where: { storeId_weekStart: { storeId, weekStart } },
  })
  if (manual) {
    // The deprecated delivery column is folded into the total so pre-Phase-2
    // rows (which split store/delivery) still read as one number.
    return { total: round2(Number(manual.projectedStoreSales) + Number(manual.projectedDelivery)), source: "MANUAL" }
  }

  const weekEndStr = (() => {
    const d = new Date(`${weekStartStr}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() + 6)
    return d.toISOString().slice(0, 10)
  })()

  const agg = await prisma.dailyGoal.aggregate({
    where: { storeId, date: { gte: dbDate(weekStartStr), lte: dbDate(weekEndStr) } },
    _sum: { goalAmount: true },
    _count: true,
  })
  if (agg._count === 0) return null
  return { total: round2(agg._sum.goalAmount ?? 0), source: "TREND" }
}
