import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { localDateStr, dbDate } from "@/lib/reports"
import { syncSalesForStore, ensureSalesCached } from "@/lib/sales-sync"

// GET /api/dashboard/summary?storeId= — everything the Dashboard needs in one
// call. NOT module-gated (the Dashboard is the landing page); the sales block
// is null when the inventory module is off or the store isn't Square-linked,
// and the UI renders a designed empty state instead.

const STALE_MS = 15 * 60 * 1000

function sameWeekdayLastYear(dateStr: string): string {
  // 364 days = exactly 52 weeks back — same weekday, closest date a year ago.
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 364)
  return d.toISOString().slice(0, 10)
}

function monthStart(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx
  const isAdmin = dbUser?.role === "ADMIN"
  const canManageGoal = isAdmin || dbUser?.role === "MANAGER"
  const scopedStoreIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })
  if (!isAdmin && !scopedStoreIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const tz = store.timezone
  const today = localDateStr(new Date(), tz)
  const comparisonDate = sameWeekdayLastYear(today)
  const mStart = monthStart(today)
  const dayOfMonth = Number(today.slice(8, 10))
  const totalDays = daysInMonth(today)

  // ── Sales block (inventory module + Square link required) ──
  const salesAvailable =
    org.activeModules.includes("inventory") && !!store.squareLocationId && !!org.squareAccessToken

  let sales: {
    today: { total: number; hourly: { hour: number; net: number }[] }
    lastYear: { date: string; total: number; hourly: { hour: number; net: number }[] } | null
    monthToDate: number
  } | null = null

  if (salesAvailable) {
    try {
      // Refresh today when stale; gap-fill the month + comparison day once.
      const todayRow = await prisma.salesPeriodCache.findUnique({
        where: { storeId_date: { storeId, date: dbDate(today) } },
        select: { syncedAt: true },
      })
      if (!todayRow || Date.now() - todayRow.syncedAt.getTime() > STALE_MS) {
        await syncSalesForStore(org, store, today, today)
      }
      await ensureSalesCached(org, store, mStart, today)
      await ensureSalesCached(org, store, comparisonDate, comparisonDate)
    } catch {
      // Square being down never blanks the dashboard — serve what's cached.
    }

    const [todayHours, lastYearHours, todayDay, lastYearDay, mtdAgg] = await Promise.all([
      prisma.salesHourlyCache.findMany({ where: { storeId, date: dbDate(today) }, orderBy: { hour: "asc" } }),
      prisma.salesHourlyCache.findMany({ where: { storeId, date: dbDate(comparisonDate) }, orderBy: { hour: "asc" } }),
      prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId, date: dbDate(today) } } }),
      prisma.salesPeriodCache.findUnique({ where: { storeId_date: { storeId, date: dbDate(comparisonDate) } } }),
      prisma.salesPeriodCache.aggregate({
        where: { storeId, date: { gte: dbDate(mStart), lte: dbDate(today) } },
        _sum: { netSales: true },
      }),
    ])

    sales = {
      today: {
        total: todayDay?.netSales ?? 0,
        hourly: todayHours.map((h) => ({ hour: h.hour, net: h.netSales })),
      },
      lastYear: lastYearDay
        ? {
            date: comparisonDate,
            total: lastYearDay.netSales,
            hourly: lastYearHours.map((h) => ({ hour: h.hour, net: h.netSales })),
          }
        : null,
      monthToDate: mtdAgg._sum.netSales ?? 0,
    }
  }

  // ── Monthly goal ──
  // A Forecasting plan (materialized DailyGoal rows) beats the legacy manual
  // StoreMonthlyGoal. Its MTD goal sum also enables goal-weighted pacing:
  // projected = MTD actual ÷ MTD goal × month goal — which respects the
  // remaining weekday mix (3 Saturdays left ≠ 1), unlike simple run-rate.
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
  const round2 = (n: number) => Math.round(n * 100) / 100
  const hasPlan = planMonthAgg._count > 0
  const planMonthGoal = hasPlan ? round2(planMonthAgg._sum.goalAmount ?? 0) : null
  const planMtdGoal = hasPlan ? round2(planMtdAgg._sum.goalAmount ?? 0) : null

  // ── Shift checklist (today, this store) ──
  const dayStartUtc = new Date(`${today}T00:00:00.000Z`)
  const dayEndUtc = new Date(`${today}T23:59:59.999Z`)
  const checklists = await prisma.checklist.findMany({
    where: { organizationId: org.id, storeId, date: { gte: dayStartUtc, lte: dayEndUtc } },
    include: {
      template: { include: { tasks: { orderBy: { orderIndex: "asc" } } } },
      taskLogs: { select: { taskId: true } },
    },
    orderBy: { date: "asc" },
  })

  const checklistItems: { id: string; checklistId: string; label: string; checked: boolean }[] = []
  for (const cl of checklists) {
    const done = new Set(cl.taskLogs.map((t) => t.taskId))
    for (const task of cl.template.tasks) {
      if (task.excludedStoreIds.includes(storeId)) continue
      checklistItems.push({ id: task.id, checklistId: cl.id, label: task.description, checked: done.has(task.id) })
    }
  }

  return NextResponse.json({
    store: { id: store.id, name: store.name, timezone: tz },
    today,
    canManageGoal,
    salesAvailable,
    sales,
    goal: {
      month: mStart,
      goalAmount: planMonthGoal ?? goalRow?.goalAmount ?? null,
      source: planMonthGoal !== null ? "plan" : goalRow ? "manual" : null,
      mtdGoal: planMtdGoal,
      monthToDate: sales?.monthToDate ?? null,
      daysElapsed: dayOfMonth,
      daysInMonth: totalDays,
    },
    checklist: {
      total: checklistItems.length,
      completed: checklistItems.filter((i) => i.checked).length,
      items: checklistItems.slice(0, 8),
      firstChecklistId: checklists[0]?.id ?? null,
    },
  })
}
