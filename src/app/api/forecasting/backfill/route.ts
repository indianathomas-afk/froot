import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { addDaysStr, basisWindow } from "@/lib/goal-engine"
import { dbDate, localDateStr } from "@/lib/reports"
import { syncSalesForStore } from "@/lib/sales-sync"

const BackfillSchema = z.object({
  storeId: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
})

const CHUNK_DAYS = 14

// POST /api/forecasting/backfill — resumable historical sync for the basis
// window of a plan year. Each call fills at most one ~2-week chunk (a year of
// orders never fits one serverless invocation); the client keeps calling until
// done:true, showing "Importing your sales… N%". Idempotent and safe to re-run.
export async function POST(req: Request) {
  const ctx = await requireForecastContext({ write: true })
  if ("error" in ctx) return ctx.error

  const parsed = BackfillSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { storeId, year } = parsed.data

  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error
  if (!store.squareLocationId) {
    return NextResponse.json({ error: "This store isn't linked to a Square location." }, { status: 400 })
  }
  if (!ctx.org.squareAccessToken) {
    return NextResponse.json({ error: "Square isn't connected — connect it in Settings first." }, { status: 400 })
  }

  // Cover the aligned window AND the full prior calendar year (the fallback
  // basis reads same-calendar dates), clamped to yesterday store-local.
  const win = basisWindow(year)
  const rangeStart = win.start < `${year - 1}-01-01` ? win.start : `${year - 1}-01-01`
  const yesterday = addDaysStr(localDateStr(new Date(), store.timezone), -1)
  const rangeEnd = win.end < yesterday ? win.end : yesterday
  if (rangeStart > rangeEnd) {
    return NextResponse.json({ done: true, totalDays: 0, coveredDays: 0 })
  }

  const cached = await prisma.salesPeriodCache.findMany({
    where: { storeId, date: { gte: dbDate(rangeStart), lte: dbDate(rangeEnd) } },
    select: { date: true },
  })
  const have = new Set(cached.map((c) => c.date.toISOString().slice(0, 10)))

  const missing: string[] = []
  for (let d = rangeStart; d <= rangeEnd; d = addDaysStr(d, 1)) {
    if (!have.has(d)) missing.push(d)
  }
  const totalDays = Math.round((dbDate(rangeEnd).getTime() - dbDate(rangeStart).getTime()) / 86400000) + 1

  if (missing.length === 0) {
    return NextResponse.json({ done: true, totalDays, coveredDays: totalDays })
  }

  const chunkStart = missing[0]
  const chunkEndCandidate = addDaysStr(chunkStart, CHUNK_DAYS - 1)
  const chunkEnd = chunkEndCandidate < rangeEnd ? chunkEndCandidate : rangeEnd

  try {
    const result = await syncSalesForStore(ctx.org, store, chunkStart, chunkEnd)
    const remaining = missing.filter((d) => d < chunkStart || d > chunkEnd).length
    return NextResponse.json({
      done: remaining === 0,
      totalDays,
      coveredDays: totalDays - remaining,
      syncedRange: { start: chunkStart, end: chunkEnd, orders: result.orders },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
