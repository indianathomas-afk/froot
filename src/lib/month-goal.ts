import { prisma } from "@/lib/prisma"
import { dbDate } from "@/lib/reports"
import { daysInMonth, monthStart, round2 } from "@/lib/pacing"

// ─── Month goal lookup (Phase F-4) ───────────────────────────────────────────
// One store's goal picture for the month containing `today` (store-local
// yyyy-mm-dd). A Forecasting plan (materialized DailyGoal rows) beats the
// legacy manual StoreMonthlyGoal. Its MTD goal sum enables goal-weighted
// pacing (see projectMonthEnd in pacing.ts). Shared by the single-store
// dashboard summary and the all-locations rollup.

export type MonthGoal = {
  month: string // yyyy-mm-01
  goalAmount: number | null
  source: "plan" | "manual" | null
  mtdGoal: number | null // plan only — manual goals have no daily distribution
  daysElapsed: number
  daysInMonth: number
}

export async function getMonthGoal(storeId: string, today: string): Promise<MonthGoal> {
  const mStart = monthStart(today)
  const totalDays = daysInMonth(today)
  const monthEnd = `${mStart.slice(0, 7)}-${String(totalDays).padStart(2, "0")}`

  const [goalRow, planMonthAgg, planMtdAgg] = await Promise.all([
    prisma.storeMonthlyGoal.findUnique({
      where: { storeId_month: { storeId, month: dbDate(mStart) } },
    }),
    prisma.dailyGoal.aggregate({
      where: { storeId, date: { gte: dbDate(mStart), lte: dbDate(monthEnd) } },
      _sum: { goalAmount: true },
      _count: true,
    }),
    prisma.dailyGoal.aggregate({
      where: { storeId, date: { gte: dbDate(mStart), lte: dbDate(today) } },
      _sum: { goalAmount: true },
    }),
  ])

  const hasPlan = planMonthAgg._count > 0
  const planMonthGoal = hasPlan ? round2(planMonthAgg._sum.goalAmount ?? 0) : null
  const planMtdGoal = hasPlan ? round2(planMtdAgg._sum.goalAmount ?? 0) : null

  return {
    month: mStart,
    goalAmount: planMonthGoal ?? goalRow?.goalAmount ?? null,
    source: planMonthGoal !== null ? "plan" : goalRow ? "manual" : null,
    mtdGoal: planMtdGoal,
    daysElapsed: Number(today.slice(8, 10)),
    daysInMonth: totalDays,
  }
}
