import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { localDateStr } from "@/lib/reports"
import { deriveDayWeightsFromSales } from "@/lib/labor-plan"

// Per-store day-of-week weighting for the weekly→daily hourly-hours split
// (basis points, index 0 = Monday … 6 = Sunday). When the store has no override
// rows, GET returns weights DERIVED from trailing sales (isOverride:false) so
// the split always has sensible defaults — the SAME derivation getWeeklyDayPlan
// uses, so the Weekly Plan and this editor always agree. PUT stores overrides;
// DELETE clears them (reset to sales-derived). ADMIN/MANAGER write, any role reads.

export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error
  const storeId = new URL(req.url).searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const rows = await prisma.laborDaySplit.findMany({ where: { storeId }, orderBy: { weekday: "asc" } })
  if (rows.length > 0) {
    const weights = Array.from({ length: 7 }, (_, wd) => rows.find((r) => r.weekday === wd)?.weightBps ?? 0)
    return NextResponse.json({ weights, isOverride: true })
  }
  const derived = await deriveDayWeightsFromSales(storeId, localDateStr(new Date(), store.timezone))
  return NextResponse.json({ weights: derived, isOverride: false })
}

const putSchema = z.object({
  storeId: z.string().min(1),
  weights: z.array(z.number().int().min(0).max(10000)).length(7),
})

export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, weights } = parsed.data
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  await prisma.$transaction(
    weights.map((weightBps, weekday) =>
      prisma.laborDaySplit.upsert({
        where: { storeId_weekday: { storeId, weekday } },
        create: { organizationId: ctx.org.id, storeId, weekday, weightBps, isOverride: true },
        update: { weightBps, isOverride: true },
      })
    )
  )
  return NextResponse.json({ weights, isOverride: true })
}

// DELETE ?storeId= — reset to the sales-derived split.
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const storeId = new URL(req.url).searchParams.get("storeId") ?? ""
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error
  await prisma.laborDaySplit.deleteMany({ where: { storeId } })
  const derived = await deriveDayWeightsFromSales(storeId, localDateStr(new Date(), store.timezone))
  return NextResponse.json({ weights: derived, isOverride: false })
}
