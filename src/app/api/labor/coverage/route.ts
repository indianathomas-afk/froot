import { NextResponse } from "next/server"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyDayPlan, computeDayCoverage, addDaysStr } from "@/lib/labor-plan"

// GET /api/labor/coverage?storeId=&date= — demand-shaped, budget-capped
// recommended coverage for one day (guidance). Works for FUTURE days (up to the
// UI's 4-week horizon). The per-day hourly cap now comes from the shared L-3
// weekly plan (floor-first split + GM 40h cap + any rebalance override); this
// route just renders the coverage engine for the selected day. Read-only, any
// role that can see the store.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const t0 = Date.now()
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const dateParam = url.searchParams.get("date")
  let date = dateParam && DATE_RE.test(dateParam) ? dateParam : today
  if (date > addDaysStr(today, 28)) date = addDaysStr(today, 28)
  const weekStart = mondayOfWeekStr(date)

  const available = ctx.org.activeModules.includes("inventory") && !!store.squareLocationId && !!ctx.org.squareAccessToken
  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"
  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, date, weekStart, available, canManage }

  const plan = await getWeeklyDayPlan(storeId, weekStart, today)
  if (!plan.budget) return NextResponse.json({ ...base, hasForecast: false, hasShape: false, coverage: null, adjustment: null })

  const day = plan.days.find((d) => d.date === date) ?? plan.days[0]
  const coverage = await computeDayCoverage(storeId, day, today, plan.hasHourlySupervisor)

  // BUG-1 evidence line: request duration in the runtime logs.
  console.log(`[api/labor/coverage] ${Date.now() - t0}ms store=${storeId} date=${date}`)

  return NextResponse.json({
    ...base,
    hasForecast: true,
    hasShape: !!coverage,
    isFuture: date > today,
    adjustment: day.adjustmentPct !== 0 ? { adjustmentPct: day.adjustmentPct, reason: day.adjustmentReason } : null,
    coverage,
  })
}
