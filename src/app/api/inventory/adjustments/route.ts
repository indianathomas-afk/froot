import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  adjustmentRouteContext,
  buildAdjustmentRow,
  canAccessStore,
  qtyInReportingUnits,
} from "@/lib/adjustments"

// Quick-log: one adjustment row (waste / comp / correction). Multi-line flows
// (transfers, loss entries, prep batches) live in their own sub-routes.
const QuickLogSchema = z.object({
  storeId: z.string().min(1),
  ingredientId: z.string().min(1),
  type: z.enum(["WASTE", "COMP", "CORRECTION"]),
  quantity: z.number().refine((n) => n !== 0, "Quantity can't be zero"),
  unit: z.string().optional(),
  reason: z.string().optional().nullable(),
  lossReasonId: z.string().optional().nullable(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
})

export async function GET(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope } = ctx

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const types = url.searchParams.get("types")?.split(",").filter(Boolean)
  const ingredientId = url.searchParams.get("ingredientId")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  if (storeId && !canAccessStore(scope, storeId)) {
    return NextResponse.json({ error: "No access to this store" }, { status: 403 })
  }

  const adjustments = await prisma.inventoryAdjustment.findMany({
    where: {
      organizationId: org.id,
      ...(storeId ? { storeId } : scope.isAdmin ? {} : { storeId: { in: scope.storeIds } }),
      ...(types?.length ? { type: { in: types } } : {}),
      ...(ingredientId ? { ingredientId } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    include: {
      lossReason: { select: { label: true } },
      store: { select: { name: true } },
      group: true,
    },
    orderBy: { occurredAt: "desc" },
    take: 500,
  })

  return NextResponse.json(adjustments)
}

export async function POST(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope, dbUser } = ctx

  const body = await req.json()
  const data = QuickLogSchema.parse(body)

  if (!canAccessStore(scope, data.storeId)) {
    return NextResponse.json({ error: "No access to this store" }, { status: 403 })
  }
  // STAFF can log waste/comps at their stores; corrections need manager+.
  if (data.type === "CORRECTION" && !scope.isManagerOrAdmin) {
    return NextResponse.json({ error: "Manager or Admin access required for corrections" }, { status: 403 })
  }

  const ingredient = await prisma.ingredient.findFirst({
    where: { id: data.ingredientId, organizationId: org.id, deletedAt: null },
  })
  if (!ingredient) return NextResponse.json({ error: "Ingredient not found" }, { status: 404 })

  const qty = qtyInReportingUnits(ingredient, data.quantity, data.unit)
  if (qty === null) {
    return NextResponse.json(
      { error: `Can't convert ${data.unit} to ${ingredient.reportingUnit} (the reporting unit of "${ingredient.name}")` },
      { status: 422 }
    )
  }

  const created = await prisma.inventoryAdjustment.create({
    data: buildAdjustmentRow({
      organizationId: org.id,
      storeId: data.storeId,
      ingredient,
      type: data.type,
      quantity: qty,
      reason: data.reason,
      lossReasonId: data.lossReasonId,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
      createdByUserId: dbUser.id,
    }),
  })

  return NextResponse.json(created, { status: 201 })
}
