import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { localDateStr, dbDate } from "@/lib/reports"
import { syncSalesForStore, ensureSalesCached } from "@/lib/sales-sync"
import { monthStart, round2, computeRollup, effectiveMtdGoal, projectMonthEnd, type RollupStoreInput } from "@/lib/pacing"
import { getMonthGoal } from "@/lib/month-goal"

// GET /api/dashboard/rollup — the Dashboard's "All locations" mode: per-store
// pacing rows plus company-wide totals with the same goal-weighted month-end
// projection applied to the summed goals (src/lib/pacing.ts — shared with the
// single-store Monthly Goal card so the two paths can't drift). Admins see
// every active store; managers/staff see their assigned stores. Stores without
// a Square link or without a plan degrade gracefully (run-rate / manual goal).

export const maxDuration = 60

const STALE_MS = 15 * 60 * 1000

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx
  const isAdmin = dbUser?.role === "ADMIN"
  const scopedStoreIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: scopedStoreIds } }) },
    orderBy: { name: "asc" },
  })

  const inventoryOn = org.activeModules.includes("inventory")
  const inputs: RollupStoreInput[] = []
  const rows: {
    storeId: string
    name: string
    salesAvailable: boolean
    goalSource: "plan" | "manual" | null
    todayNet: number
    mtdActual: number
    mtdGoal: number | null
    monthGoal: number | null
    pace: number | null
    projected: number | null
    pctToGoal: number | null
  }[] = []

  // Serial on purpose (same reasoning as the reconcile cron — stay polite to
  // Square). With order webhooks keeping today fresh, the stale branch rarely
  // fires; cache reads dominate.
  for (const store of stores) {
    const today = localDateStr(new Date(), store.timezone)
    const mStart = monthStart(today)
    const salesAvailable = inventoryOn && !!store.squareLocationId && !!org.squareAccessToken

    if (salesAvailable) {
      try {
        const todayRow = await prisma.salesPeriodCache.findUnique({
          where: { storeId_date: { storeId: store.id, date: dbDate(today) } },
          select: { syncedAt: true },
        })
        if (!todayRow || Date.now() - todayRow.syncedAt.getTime() > STALE_MS) {
          await syncSalesForStore(org, store, today, today)
        }
        await ensureSalesCached(org, store, mStart, today)
      } catch {
        // Square being down never blanks the rollup — serve what's cached.
      }
    }

    const [todayDay, mtdAgg, goal] = await Promise.all([
      prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: store.id, date: dbDate(today) } } }),
      prisma.salesPeriodCache.aggregate({
        where: { storeId: store.id, date: { gte: dbDate(mStart), lte: dbDate(today) } },
        _sum: { netSales: true },
      }),
      getMonthGoal(store.id, today),
    ])

    const input: RollupStoreInput = {
      todayNet: todayDay?.netSales ?? 0,
      mtdActual: mtdAgg._sum.netSales ?? 0,
      mtdGoal: goal.mtdGoal,
      monthGoal: goal.goalAmount,
      goalSource: goal.source,
      daysElapsed: goal.daysElapsed,
      daysInMonth: goal.daysInMonth,
    }
    inputs.push(input)

    // Per-store projection uses the exact Monthly Goal card formula (plan →
    // goal-weighted, otherwise run-rate); pace compares MTD actual to the
    // plan's MTD goal, or to a linear proration of a manual goal.
    const effMtd = effectiveMtdGoal(input)
    const projected =
      input.monthGoal !== null || input.mtdActual > 0
        ? round2(projectMonthEnd({ mtdActual: input.mtdActual, mtdGoal: input.mtdGoal, monthGoal: input.monthGoal, daysElapsed: input.daysElapsed, daysInMonth: input.daysInMonth }))
        : null
    rows.push({
      storeId: store.id,
      name: store.name,
      salesAvailable,
      goalSource: goal.source,
      todayNet: round2(input.todayNet),
      mtdActual: round2(input.mtdActual),
      mtdGoal: effMtd,
      monthGoal: input.monthGoal,
      pace: effMtd !== null && effMtd > 0 ? (input.mtdActual / effMtd) * 100 : null,
      projected,
      pctToGoal: projected !== null && input.monthGoal !== null && input.monthGoal > 0 ? (projected / input.monthGoal) * 100 : null,
    })
  }

  return NextResponse.json({
    month: monthStart(localDateStr(new Date(), stores[0]?.timezone ?? "America/Los_Angeles")),
    totals: computeRollup(inputs),
    stores: rows,
  })
}
