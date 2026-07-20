import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { mondayOfWeekStr } from "@/lib/labor-week"

// Weekly sales forecast entry (ADMIN + MANAGER). Upsert on (storeId, weekStart)
// with weekStart normalized to the Monday of its week so week keys are stable.
// Money is DOLLARS (Decimal); Phase 1 writes source = MANUAL only.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function serialize(f: {
  storeId: string
  weekStart: Date
  projectedStoreSales: unknown
  projectedDelivery: unknown
  source: string
}) {
  return {
    storeId: f.storeId,
    weekStart: f.weekStart.toISOString().slice(0, 10),
    projectedStoreSales: Number(f.projectedStoreSales),
    projectedDelivery: Number(f.projectedDelivery),
    source: f.source,
  }
}

// GET /api/labor/forecast?storeId=&weekStart= — the forecast for that store's
// week (weekStart snapped to Monday), or { forecast: null } if none exists.
export async function GET(req: Request) {
  const ctx = await requireLaborContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const weekStartParam = url.searchParams.get("weekStart") ?? ""
  if (!DATE_RE.test(weekStartParam)) {
    return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 })
  }
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const weekStart = new Date(`${mondayOfWeekStr(weekStartParam)}T00:00:00.000Z`)
  const forecast = await prisma.salesForecast.findUnique({
    where: { storeId_weekStart: { storeId, weekStart } },
  })
  return NextResponse.json({ forecast: forecast ? serialize(forecast) : null })
}

const putSchema = z.object({
  storeId: z.string().min(1),
  weekStart: z.string().regex(DATE_RE),
  projectedStoreSales: z.number().nonnegative().max(99999999),
  projectedDelivery: z.number().nonnegative().max(99999999),
})

// PUT /api/labor/forecast — create/update the week's forecast.
export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, projectedStoreSales, projectedDelivery } = parsed.data

  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const weekStart = new Date(`${mondayOfWeekStr(parsed.data.weekStart)}T00:00:00.000Z`)

  const forecast = await prisma.salesForecast.upsert({
    where: { storeId_weekStart: { storeId, weekStart } },
    create: {
      organizationId: ctx.org.id,
      storeId,
      weekStart,
      projectedStoreSales,
      projectedDelivery,
      source: "MANUAL",
      createdById: ctx.userId,
    },
    update: {
      projectedStoreSales,
      projectedDelivery,
      source: "MANUAL",
    },
  })
  return NextResponse.json({ forecast: serialize(forecast) })
}
