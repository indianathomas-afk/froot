import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { dbDate, localDateStr } from "@/lib/reports"

// Per-store day-of-week weighting for the weekly→daily hourly-hours split
// (basis points, index 0 = Monday … 6 = Sunday). When the store has no override
// rows, GET returns weights DERIVED from trailing sales (isOverride:false) so
// the split always has sensible defaults. PUT stores overrides; DELETE clears
// them (reset to sales-derived). ADMIN/MANAGER write, any role reads.

const TRAILING_DAYS = 56 // ~8 weeks of trailing actuals for the derived split

function weekdayOf(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()
  return (dow + 6) % 7
}

// Even split with the rounding remainder pinned to the last weekday so bps
// always sum to exactly 10000.
function evenWeights(): number[] {
  const base = Math.floor(10000 / 7)
  const w = new Array(7).fill(base)
  w[6] += 10000 - base * 7
  return w
}

async function deriveFromSales(storeId: string, today: string): Promise<number[]> {
  const start = (() => {
    const d = new Date(`${today}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - TRAILING_DAYS)
    return d.toISOString().slice(0, 10)
  })()
  const rows = await prisma.salesPeriodCache.findMany({
    where: { storeId, date: { gte: dbDate(start), lte: dbDate(today) } },
    select: { date: true, netSales: true },
  })
  const byWd = new Array(7).fill(0)
  for (const r of rows) byWd[weekdayOf(r.date.toISOString().slice(0, 10))] += r.netSales
  const grand = byWd.reduce((a, b) => a + b, 0)
  if (grand <= 0) return evenWeights()
  const raw = byWd.map((v) => Math.round((v / grand) * 10000))
  // Pin drift to the heaviest day so the total is exactly 10000.
  const drift = 10000 - raw.reduce((a, b) => a + b, 0)
  const maxIdx = raw.indexOf(Math.max(...raw))
  raw[maxIdx] += drift
  return raw
}

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
  const derived = await deriveFromSales(storeId, localDateStr(new Date(), store.timezone))
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
  const derived = await deriveFromSales(storeId, localDateStr(new Date(), store.timezone))
  return NextResponse.json({ weights: derived, isOverride: false })
}
