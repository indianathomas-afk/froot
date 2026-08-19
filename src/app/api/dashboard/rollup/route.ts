import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { localDateStr, dbDate } from "@/lib/reports"
import { syncSalesForStore, ensureSalesCached } from "@/lib/sales-sync"
import { monthStart, round2, daysInMonth, computeRollup, effectiveMtdGoal, projectMonthEnd, type RollupStoreInput } from "@/lib/pacing"
import { getMonthGoal } from "@/lib/month-goal"
import {
  laborOverlayOn,
  loadEstateLabor,
  loadLaborBlocks,
  scheduleLaborRefresh,
} from "@/lib/labor-dashboard"
import type { EstateLaborBlock, LaborBlock } from "@/lib/labor-judgment"

// GET /api/dashboard/rollup — the Dashboard's "All locations" mode: per-store
// pacing rows plus company-wide totals with the same goal-weighted month-end
// projection applied to the summed goals (src/lib/pacing.ts — shared with the
// single-store Monthly Goal card so the two paths can't drift). Admins see
// every active store; managers/staff see their assigned stores. Stores without
// a Square link or without a plan degrade gracefully (run-rate / manual goal).

export const maxDuration = 60

const STALE_MS = 15 * 60 * 1000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 366

export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser, actor } = ctx
  const isAdmin = dbUser?.role === "ADMIN"
  const scopedStoreIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: scopedStoreIds } }) },
    orderBy: { name: "asc" },
  })

  // AL-2 feature 6 — THE RANGE DRIVES THE STORE RANKING TABLE ONLY. The three
  // summary cards above it stay month-anchored (Gary's R6, 2026-08-19): [Today ·
  // All Locations], [to Date] and [Projected Month End] are definitionally
  // today/MTD/month-end figures, and re-pointing them at "last week" would leave
  // three cards whose titles no longer described their contents.
  //
  // Defaults to the current month so a caller that passes nothing gets exactly
  // the pre-AL-2 table. Anchored on the FIRST store's zone, the same choice the
  // `month` field below already makes.
  const anchorTz = stores[0]?.timezone ?? "America/Los_Angeles"
  const anchorToday = localDateStr(new Date(), anchorTz)
  const mStartAnchor = monthStart(anchorToday)
  const url = new URL(req.url)
  const rawStart = url.searchParams.get("start")
  const rawEnd = url.searchParams.get("end")
  let rangeStart = rawStart && DATE_RE.test(rawStart) ? rawStart : monthStart(anchorToday)
  let rangeEnd = rawEnd && DATE_RE.test(rawEnd) ? rawEnd : anchorToday
  // Clamp rather than error, matching /api/dashboard/sales: a selection persisted
  // across midnight must still resolve instead of blanking the table.
  if (rangeEnd > anchorToday) rangeEnd = anchorToday
  if (rangeStart > rangeEnd) rangeStart = rangeEnd
  if (Math.round((Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86400000) + 1 > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `Range is limited to ${MAX_RANGE_DAYS} days` }, { status: 400 })
  }

  const inventoryOn = org.activeModules.includes("inventory")
  const inputs: RollupStoreInput[] = []
  const rows: {
    storeId: string
    name: string
    salesAvailable: boolean
    goalSource: "plan" | "manual" | null
    todayNet: number
    mtdActual: number
    /// AL-2 — net sales over the SELECTED RANGE. Sent beside the labor % because
    /// a labor percentage without the sales it divides by is not checkable.
    rangeNet: number
    mtdGoal: number | null
    monthGoal: number | null
    pace: number | null
    projected: number | null
    pctToGoal: number | null
    labor?: LaborBlock
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

    const [todayDay, mtdAgg, rangeAgg, goal] = await Promise.all([
      prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId: store.id, date: dbDate(today) } } }),
      prisma.salesPeriodCache.aggregate({
        where: { storeId: store.id, date: { gte: dbDate(mStart), lte: dbDate(today) } },
        _sum: { netSales: true },
      }),
      prisma.salesPeriodCache.aggregate({
        where: { storeId: store.id, date: { gte: dbDate(rangeStart), lte: dbDate(rangeEnd) } },
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
      rangeNet: round2(rangeAgg._sum.netSales ?? 0),
      mtdGoal: effMtd,
      monthGoal: input.monthGoal,
      pace: effMtd !== null && effMtd > 0 ? (input.mtdActual / effMtd) * 100 : null,
      projected,
      pctToGoal: projected !== null && input.monthGoal !== null && input.monthGoal > 0 ? (projected / input.monthGoal) * 100 : null,
    })
  }

  const totals = computeRollup(inputs)

  // ── AL-2: labor ──
  // THREE WINDOWS, THREE BATCHED READS, not three per store. The per-store column
  // follows the range picker (feature 7 + 6); the summary card is month-anchored
  // and needs today and MTD (feature 4). Each loadLabor* call is a fixed number of
  // queries regardless of how many stores are in scope — see
  // getLaborActualsForStores.
  const laborTotals = await buildLaborTotals(org, stores, actor, mStartAnchor, anchorToday, totals.projected)
  const laborByStore = await loadLaborBlocks(org, stores, actor, rangeStart, rangeEnd)
  if (laborByStore) {
    for (const row of rows) {
      const block = laborByStore.get(row.storeId)
      if (block) row.labor = block
    }
  }
  // Freshness for the whole estate, bounded and deferred — see
  // scheduleLaborRefresh's per-load cap. Attempted whenever the OVERLAY is on,
  // independent of whether any individual store is currently connected (R1).
  if (laborByStore && laborOverlayOn(org)) scheduleLaborRefresh(org, stores)

  return NextResponse.json({
    month: monthStart(anchorToday),
    range: { start: rangeStart, end: rangeEnd },
    totals,
    stores: rows,
    ...(laborTotals ? { laborTotals } : {}),
  })
}

/// The [Today · All Locations] / [to Date] / [Projected Month End] labor figures.
///
/// THE PROJECTION, per Gary's R4 (2026-08-19):
///   projectedLaborPct = projectedLaborCost / projectedNetSales
/// where projectedNetSales is THE NUMBER THE CARD BESIDE IT ALREADY PRINTS — the
/// goal-weighted pacing.ts projection — rather than a second, differently-derived
/// month-end sales figure. Two different month-end sales numbers on one card is a
/// worse defect than one mixed basis, and the mixed basis is LABELLED on the card.
///
/// The numerator is a run-rate on the DAYS THAT ACTUALLY CARRY TIMECARDS, never
/// on days elapsed. Dividing a three-day cost by nineteen elapsed days is the
/// same coverage defect the percentage itself was fixed for, and here it
/// understates rather than overstates — the direction that reads as good news.
async function buildLaborTotals(
  org: Awaited<ReturnType<typeof getCurrentUser>>["org"],
  stores: Awaited<ReturnType<typeof prisma.store.findMany>>,
  actor: Awaited<ReturnType<typeof getCurrentUser>>["actor"],
  mStartAnchor: string,
  anchorToday: string,
  projectedNetSales: number | null
): Promise<{
  today: EstateLaborBlock
  mtd: EstateLaborBlock
  projectedPct: number | null
  projectionDaysCovered: number
} | null> {
  const [today, mtd] = await Promise.all([
    loadEstateLabor(org, stores, actor, anchorToday, anchorToday),
    loadEstateLabor(org, stores, actor, mStartAnchor, anchorToday),
  ])
  if (!today || !mtd) return null

  // THE NUMERATOR is a run-rate on the DAYS THAT ACTUALLY CARRY TIMECARDS, never
  // on days elapsed. Dividing a three-day cost by nineteen elapsed days is the
  // same coverage defect the percentage itself was fixed for, and here it
  // understates — the direction that reads as good news.
  const totalDays = daysInMonth(anchorToday)
  const projectedLaborCost =
    mtd.block.daysCovered > 0 ? (mtd.laborCost / mtd.block.daysCovered) * totalDays : null

  return {
    today: today.block,
    mtd: mtd.block,
    projectedPct:
      projectedLaborCost !== null && projectedNetSales !== null && projectedNetSales > 0
        ? (projectedLaborCost / projectedNetSales) * 100
        : null,
    projectionDaysCovered: mtd.block.daysCovered,
  }
}
