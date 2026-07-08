import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  adjustmentRouteContext,
  buildAdjustmentRow,
  canAccessStore,
  qtyInReportingUnits,
} from "@/lib/adjustments"

// One transfer = one AdjustmentGroup header + paired TRANSFER_OUT/TRANSFER_IN
// rows per line. Custom destination (toStoreId null + destinationLabel, e.g.
// "Kitchen" or "Catering — Smith wedding") writes OUT rows only. Ingredients
// are org-level (I-3 core rule) so no item mapping between stores is needed.
// occurredAt is backdatable so the rows land in the right inventory period.
const TransferSchema = z
  .object({
    fromStoreId: z.string().min(1),
    toStoreId: z.string().optional().nullable(),
    destinationLabel: z.string().trim().min(1).optional().nullable(),
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
  .refine((t) => !!t.toStoreId !== !!t.destinationLabel, {
    message: "Provide either a destination store or a custom destination label, not both",
  })
  .refine((t) => !t.toStoreId || t.toStoreId !== t.fromStoreId, {
    message: "A transfer needs two different stores",
  })

export async function GET(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope } = ctx

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const destination = url.searchParams.get("destination")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  const groups = await prisma.adjustmentGroup.findMany({
    where: {
      organizationId: org.id,
      type: "TRANSFER",
      ...(storeId ? { OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] } : {}),
      ...(!scope.isAdmin && !storeId
        ? { OR: [{ fromStoreId: { in: scope.storeIds } }, { toStoreId: { in: scope.storeIds } }] }
        : {}),
      ...(destination ? { destinationLabel: destination } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    include: {
      fromStore: { select: { id: true, name: true } },
      toStore: { select: { id: true, name: true } },
      adjustments: { where: { type: "TRANSFER_OUT" }, orderBy: { ingredientName: "asc" } },
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  })

  return NextResponse.json(groups)
}

export async function POST(req: Request) {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org, scope, dbUser } = ctx

  const body = await req.json()
  const data = TransferSchema.parse(body)

  if (!canAccessStore(scope, data.fromStoreId)) {
    return NextResponse.json({ error: "No access to the sending store" }, { status: 403 })
  }

  const storeIds = [data.fromStoreId, ...(data.toStoreId ? [data.toStoreId] : [])]
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds }, organizationId: org.id } })
  if (stores.length !== storeIds.length) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 })
  }

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
        type: "TRANSFER",
        fromStoreId: data.fromStoreId,
        toStoreId: data.toStoreId ?? null,
        destinationLabel: data.destinationLabel ?? null,
        occurredAt,
        note: data.note ?? null,
        createdByUserId: dbUser.id,
      },
    })
    await tx.inventoryAdjustment.createMany({
      data: converted.flatMap(({ ingredient, qty }) => {
        const common = {
          organizationId: org.id,
          ingredient,
          quantity: qty,
          groupId: created.id,
          occurredAt,
          createdByUserId: dbUser.id,
        }
        return [
          buildAdjustmentRow({ ...common, storeId: data.fromStoreId, type: "TRANSFER_OUT" }),
          ...(data.toStoreId
            ? [buildAdjustmentRow({ ...common, storeId: data.toStoreId, type: "TRANSFER_IN" })]
            : []),
        ]
      }),
    })
    return created
  })

  const full = await prisma.adjustmentGroup.findUnique({
    where: { id: group.id },
    include: {
      fromStore: { select: { id: true, name: true } },
      toStore: { select: { id: true, name: true } },
      adjustments: true,
    },
  })
  return NextResponse.json(full, { status: 201 })
}
