import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireCountsContext } from "@/lib/count-access"
import { syncSalesForStore } from "@/lib/sales-sync"

const SyncSchema = z.object({
  storeId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// POST /api/square/sales/sync {storeId, startDate, endDate} — pull COMPLETED
// Square orders for the store and rebuild the daily/hourly/line sales caches
// for that window. Idempotent per day.
export async function POST(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const body = await req.json()
  const parsed = SyncSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { storeId, startDate, endDate } = parsed.data

  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be on or before endDate" }, { status: 400 })
  }

  if (!ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })
  if (!store.squareLocationId) {
    return NextResponse.json(
      { error: "This store isn't linked to a Square location — set its Square location in Stores before syncing sales." },
      { status: 400 }
    )
  }
  if (!ctx.org.squareAccessToken) {
    return NextResponse.json({ error: "Square isn't connected — connect it in Settings first." }, { status: 400 })
  }

  try {
    const result = await syncSalesForStore(ctx.org, store, startDate, endDate)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
