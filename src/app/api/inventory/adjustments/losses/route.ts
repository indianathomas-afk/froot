import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  adjustmentRouteContext,
  buildAdjustmentRow,
  canAccessStore,
  qtyInReportingUnits,
} from "@/lib/adjustments"

// One loss entry = one AdjustmentGroup header (backdatable, reason + note) +
// one WASTE/COMP row per line. The single-item quick log stays in
// /api/inventory/adjustments — this is the multi-line flow mirroring transfers.
const LossSchema = z.object({
  storeId: z.string().min(1),
  type: z.enum(["WASTE", "COMP"]).default("WASTE"),
  lossReasonId: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  note: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        quantity: z.number().positive(),
        unit: z.string().optional(),
      })
    )
    .min(1),
})

export async function POST(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope, dbUser } = ctx

  const body = await req.json()
  const data = LossSchema.parse(body)

  if (!canAccessStore(scope, data.storeId)) {
    return NextResponse.json({ error: "No access to this store" }, { status: 403 })
  }

  const lossReason = await prisma.lossReason.findFirst({
    where: { id: data.lossReasonId, organizationId: org.id },
  })
  if (!lossReason) return NextResponse.json({ error: "Loss reason not found" }, { status: 404 })

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: data.lines.map((l) => l.ingredientId) }, organizationId: org.id, deletedAt: null },
  })
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))

  const converted: { ingredient: (typeof ingredients)[number]; qty: number }[] = []
  for (const [index, line] of data.lines.entries()) {
    const ingredient = ingredientById.get(line.ingredientId)
    if (!ingredient) {
      return NextResponse.json({ error: `Line ${index + 1}: ingredient not found` }, { status: 404 })
    }
    const qty = qtyInReportingUnits(ingredient, line.quantity, line.unit)
    if (qty === null) {
      return NextResponse.json(
        { error: `Line ${index + 1}: can't convert ${line.unit} to ${ingredient.reportingUnit} ("${ingredient.name}")` },
        { status: 422 }
      )
    }
    converted.push({ ingredient, qty })
  }

  const occurredAt = new Date(data.occurredAt)
  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.adjustmentGroup.create({
      data: {
        organizationId: org.id,
        type: "LOSS",
        fromStoreId: data.storeId,
        occurredAt,
        note: data.note ?? null,
        createdByUserId: dbUser.id,
      },
    })
    await tx.inventoryAdjustment.createMany({
      data: converted.map(({ ingredient, qty }) =>
        buildAdjustmentRow({
          organizationId: org.id,
          storeId: data.storeId,
          ingredient,
          type: data.type,
          quantity: qty,
          lossReasonId: data.lossReasonId,
          groupId: created.id,
          occurredAt,
          createdByUserId: dbUser.id,
        })
      ),
    })
    return created
  })

  const full = await prisma.adjustmentGroup.findUnique({
    where: { id: group.id },
    include: { adjustments: { include: { lossReason: { select: { label: true } } } } },
  })
  return NextResponse.json(full, { status: 201 })
}
