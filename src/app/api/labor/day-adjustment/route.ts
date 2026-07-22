import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireLaborView, requireLaborContext, requireLaborStore } from "@/lib/labor-access"
import { dbDate } from "@/lib/reports"

// Date-specific labor adjustment (weather/holiday/event) — scales that day's
// HOURLY hours by adjustmentPct (e.g. -20 = staff 20% below); salaried is
// untouched. Upsert on (storeId, date). ADMIN/MANAGER write, any role reads.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function serialize(a: { date: Date; adjustmentPct: unknown; reason: string | null }) {
  return { date: a.date.toISOString().slice(0, 10), adjustmentPct: Number(a.adjustmentPct), reason: a.reason }
}

// GET ?storeId=&date= — the adjustment for one date (or { adjustment: null }).
export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error
  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const date = url.searchParams.get("date") ?? ""
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const row = await prisma.laborDayAdjustment.findUnique({ where: { storeId_date: { storeId, date: dbDate(date) } } })
  return NextResponse.json({ adjustment: row ? serialize(row) : null })
}

const putSchema = z.object({
  storeId: z.string().min(1),
  date: z.string().regex(DATE_RE),
  adjustmentPct: z.number().min(-100).max(100),
  reason: z.string().trim().max(120).nullable().optional(),
})

// PUT — create/update the day's adjustment.
export async function PUT(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { storeId, date, adjustmentPct, reason } = parsed.data
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const row = await prisma.laborDayAdjustment.upsert({
    where: { storeId_date: { storeId, date: dbDate(date) } },
    create: { organizationId: ctx.org.id, storeId, date: dbDate(date), adjustmentPct, reason: reason ?? null, createdById: ctx.userId },
    update: { adjustmentPct, reason: reason ?? null },
  })
  return NextResponse.json({ adjustment: serialize(row) })
}

// DELETE ?storeId=&date= — remove the adjustment (back to no change).
export async function DELETE(req: Request) {
  const ctx = await requireLaborContext({ write: true })
  if ("error" in ctx) return ctx.error
  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  const date = url.searchParams.get("date") ?? ""
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  await prisma.laborDayAdjustment.deleteMany({ where: { storeId, date: dbDate(date) } })
  return NextResponse.json({ success: true })
}
