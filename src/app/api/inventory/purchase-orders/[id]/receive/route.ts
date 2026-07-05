import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireModule } from "@/lib/auth"

const ReceiveSchema = z.array(
  z.object({
    lineId: z.string().min(1),
    quantityReceivedDelta: z.number().positive(),
    receivingNote: z.string().optional().nullable(),
  })
).min(1)

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const { isAdmin, storeIds } = await getUserStoreScope()
  const { id } = await params

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: org.id, ...(isAdmin ? {} : { storeId: { in: storeIds } }) },
    include: { lines: { include: { ingredient: true } } },
  })
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (po.status !== "SUBMITTED" && po.status !== "PARTIALLY_RECEIVED") {
    return NextResponse.json({ error: "Purchase order is not open for receiving" }, { status: 409 })
  }

  const body = await req.json()
  const receipts = ReceiveSchema.parse(body)

  const linesById = new Map(po.lines.map((l) => [l.id, l]))
  for (const r of receipts) {
    if (!linesById.has(r.lineId)) {
      return NextResponse.json({ error: `Line ${r.lineId} not found on this purchase order` }, { status: 400 })
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const r of receipts) {
      const line = linesById.get(r.lineId)!
      const quantityReceived = Math.min(line.quantityReceived + r.quantityReceivedDelta, line.quantityOrdered)

      await tx.purchaseOrderLine.update({
        where: { id: r.lineId },
        data: {
          quantityReceived,
          ...(r.receivingNote !== undefined && { receivingNote: r.receivingNote || null }),
        },
      })

      await tx.vendorIngredient.upsert({
        where: { vendorId_ingredientId: { vendorId: po.vendorId, ingredientId: line.ingredientId } },
        create: { vendorId: po.vendorId, ingredientId: line.ingredientId, casePrice: line.unitCost },
        update: { casePrice: line.unitCost },
      })

      // Most-recent-cost method: the price just paid becomes the ingredient's
      // current cost everywhere it's displayed (recipes, reports, etc.).
      await tx.ingredient.update({
        where: { id: line.ingredientId },
        data: {
          purchaseCost: line.unitCost,
          costPerReportingUnit: line.unitCost / line.ingredient.unitsPerPurchase,
        },
      })
    }

    const freshLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } })
    const allFull = freshLines.every((l) => l.quantityReceived >= l.quantityOrdered)
    const anyReceived = freshLines.some((l) => l.quantityReceived > 0)

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: allFull ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status },
    })
  })

  const updated = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { ingredient: true } }, store: true, vendor: true },
  })

  return NextResponse.json(updated)
}
