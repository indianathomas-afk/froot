import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { mondayOfWeekStr } from "@/lib/labor-week"

// Weekly sales forecast OVERRIDE (ADMIN + MANAGER). Phase 2: the budget
// auto-derives the week's total from the Forecasting module; this route stores
// a MANUAL override when the operator wants a different number. Total sales
// only — stored in projectedStoreSales (the deprecated projectedDelivery column
// is written 0 and folded into the total on read). Upsert on (storeId,
// weekStart), weekStart snapped to Monday.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function serialize(f: { storeId: string; weekStart: Date; projectedStoreSales: unknown; projectedDelivery: unknown; source: string }) {
  return {
    storeId: f.storeId,
    weekStart: f.weekStart.toISOString().slice(0, 10),
    total: Number(f.projectedStoreSales) + Number(f.projectedDelivery),
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
  total: z.number().nonnegative().max(99999999),
})

// PUT /api/labor/forecast — set/replace the week's MANUAL override total.
export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, total } = parsed.data

  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const weekStart = new Date(`${mondayOfWeekStr(parsed.data.weekStart)}T00:00:00.000Z`)

  const forecast = await prisma.salesForecast.upsert({
    where: { storeId_weekStart: { storeId, weekStart } },
    create: { organizationId: ctx.org.id, storeId, weekStart, projectedStoreSales: total, projectedDelivery: 0, source: "MANUAL", createdById: ctx.userId },
    update: { projectedStoreSales: total, projectedDelivery: 0, source: "MANUAL" },
  })
  return NextResponse.json({ forecast: serialize(forecast) })
}

// DELETE ?storeId=&weekStart= — remove the manual override (revert to the
// auto-derived Forecasting total).
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const weekStartParam = url.searchParams.get("weekStart") ?? ""
  if (!DATE_RE.test(weekStartParam)) return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 })
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error
  const weekStart = new Date(`${mondayOfWeekStr(weekStartParam)}T00:00:00.000Z`)
  await prisma.salesForecast.deleteMany({ where: { storeId, weekStart } })
  return NextResponse.json({ success: true })
}
