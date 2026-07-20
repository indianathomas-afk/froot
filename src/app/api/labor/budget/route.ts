import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { localDateStr } from "@/lib/reports"
import { mondayOfWeekStr } from "@/lib/labor-week"
import { computeWeeklyLaborBudget } from "@/lib/labor-budget"

// GET /api/labor/budget?storeId=&weekStart= — the derived weekly labor budget
// for a store's week. Read-only, available to every role that can see the store
// (STORE/STAFF get the dashboard card too); the config routes stay ADMIN/MANAGER.
// weekStart defaults to the current week (store-local) and snaps to Monday.
// Returns hasForecast:false + budget:null when no forecast exists — the card
// renders the empty state rather than a broken card.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const weekStartParam = url.searchParams.get("weekStart")
  const weekStart = mondayOfWeekStr(weekStartParam && DATE_RE.test(weekStartParam) ? weekStartParam : today)

  const [settingsRow, positions, forecastRow] = await Promise.all([
    prisma.laborSettings.findFirst({ where: { organizationId: ctx.org.id, storeId: null } }),
    prisma.laborPosition.findMany({ where: { organizationId: ctx.org.id, active: true } }),
    prisma.salesForecast.findUnique({
      where: { storeId_weekStart: { storeId, weekStart: new Date(`${weekStart}T00:00:00.000Z`) } },
    }),
  ])

  const settings = {
    laborTargetPct: settingsRow ? Number(settingsRow.laborTargetPct) : 20,
    roundingIncrement: settingsRow ? Number(settingsRow.roundingIncrement) : 1000,
    denominator: settingsRow?.denominator ?? ("TOTAL_WITH_DELIVERY" as const),
    plannedBlendedRate:
      settingsRow?.plannedBlendedRate == null ? null : Number(settingsRow.plannedBlendedRate),
  }

  const forecast = forecastRow
    ? {
        projectedStoreSales: Number(forecastRow.projectedStoreSales),
        projectedDelivery: Number(forecastRow.projectedDelivery),
        source: forecastRow.source,
      }
    : null

  const budget = computeWeeklyLaborBudget({
    settings,
    positions: positions.map((p) => ({
      payType: p.payType,
      defaultHourlyRate: Number(p.defaultHourlyRate),
      impliedWeeklyHours: p.impliedWeeklyHours,
      active: p.active,
    })),
    forecast: forecast && { projectedStoreSales: forecast.projectedStoreSales, projectedDelivery: forecast.projectedDelivery },
  })

  const canManage = ctx.isAdmin || ctx.dbUser?.role === "MANAGER"

  return NextResponse.json({
    store: { id: store.id, name: store.name, timezone: store.timezone },
    today,
    weekStart,
    canManage,
    target: settings.laborTargetPct,
    denominator: settings.denominator,
    hasForecast: !!forecast,
    forecast,
    budget,
  })
}
