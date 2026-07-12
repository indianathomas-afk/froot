import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { localDateStr, dbDate } from "@/lib/reports"
import { syncSalesForStore, ensureSalesCached } from "@/lib/sales-sync"
import { monthStart } from "@/lib/pacing"
import { getMonthGoal } from "@/lib/month-goal"

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
  // Shared with the all-locations rollup (src/lib/month-goal.ts): a
  // Forecasting plan beats the legacy manual StoreMonthlyGoal, and its MTD
  // goal sum enables goal-weighted pacing (projectMonthEnd in pacing.ts).
  const monthGoal = await getMonthGoal(storeId, today)

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
      ...monthGoal,
      monthToDate: sales?.monthToDate ?? null,
    },
    checklist: {
      total: checklistItems.length,
      completed: checklistItems.filter((i) => i.checked).length,
      items: checklistItems.slice(0, 8),
      firstChecklistId: checklists[0]?.id ?? null,
    },
  })
}
