import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin } from "@/lib/auth"
import { adjustmentRouteContext, canAccessStore } from "@/lib/adjustments"

// Manual sold-quantity corrections for the Variance report ONLY. One row per
// (store, salesItem, period), upserted; qtyDelta 0 clears it. Square sales
// data is never modified.
const UpsertSchema = z.object({
  storeId: z.string().min(1),
  salesItemId: z.string().min(1),
  periodKey: z.string().min(1),
  qtyDelta: z.number(),
  note: z.string().optional().nullable(),
})

export async function POST(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope, dbUser } = ctx

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const body = await req.json()
  const data = UpsertSchema.parse(body)

  if (!canAccessStore(scope, data.storeId)) {
    return NextResponse.json({ error: "No access to this store" }, { status: 403 })
  }
  const salesItem = await prisma.salesItem.findFirst({
    where: { id: data.salesItemId, organizationId: org.id },
  })
  if (!salesItem) return NextResponse.json({ error: "Sales item not found" }, { status: 404 })

  const where = {
    storeId_salesItemId_periodKey: {
      storeId: data.storeId,
      salesItemId: data.salesItemId,
      periodKey: data.periodKey,
    },
  }

  if (data.qtyDelta === 0) {
    await prisma.varianceAdjustment.deleteMany({
      where: { storeId: data.storeId, salesItemId: data.salesItemId, periodKey: data.periodKey },
    })
    return NextResponse.json({ success: true, cleared: true })
  }

  const row = await prisma.varianceAdjustment.upsert({
    where,
    create: {
      organizationId: org.id,
      storeId: data.storeId,
      salesItemId: data.salesItemId,
      periodKey: data.periodKey,
      qtyDelta: data.qtyDelta,
      note: data.note ?? null,
      createdByUserId: dbUser.id,
    },
    update: { qtyDelta: data.qtyDelta, note: data.note ?? null },
  })
  return NextResponse.json(row, { status: 201 })
}
