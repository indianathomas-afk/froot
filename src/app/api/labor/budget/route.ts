import { NextResponse } from "next/server"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { getWeeklyDayPlan } from "@/lib/labor-plan"

// GET /api/labor/budget?storeId=&weekStart= — the derived weekly labor budget.
// The week's projected sales are AUTO-DERIVED (getWeeklyForecast: MANUAL
// override else the Forecasting DailyGoal sum). Per-day adjustments + the L-3
// floor-first split / rebalance overrides scale that day's hourly hours; the
// hero shows the adjusted weekly total. Read-only, any role that can see the
// store. hasForecast:false → the card shows its empty state.

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
  const weekStartParam = url.searchParams.get("weekStart")
  const weekStart = mondayOfWeekStr(weekStartParam && DATE_RE.test(weekStartParam) ? weekStartParam : today)

  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"
  const plan = await getWeeklyDayPlan(storeId, weekStart, today)
  const base = { store: { id: store.id, name: store.name, timezone: store.timezone }, today, weekStart, canManage, target: plan.target }

  if (!plan.budget) {
    return NextResponse.json({ ...base, source: null, hasForecast: false, forecast: null, budget: null, adjustedTotalSchedulableHours: null, weekAdjustments: [] })
  }

  const weekAdjustments = plan.days
    .filter((d) => d.adjustmentPct !== 0)
    .map((d) => ({ date: d.date, adjustmentPct: d.adjustmentPct, reason: d.adjustmentReason }))
    .sort((x, y) => x.date.localeCompare(y.date))

  // BUG-1 evidence line: request duration in the runtime logs.
  console.log(`[api/labor/budget] ${Date.now() - t0}ms store=${storeId} week=${weekStart}`)

  return NextResponse.json({
    ...base,
    source: plan.forecast!.source,
    hasForecast: true,
    forecast: plan.forecast,
    budget: plan.budget,
    adjustedTotalSchedulableHours: plan.adjustedTotalSchedulableHours,
    weekAdjustments,
  })
}
