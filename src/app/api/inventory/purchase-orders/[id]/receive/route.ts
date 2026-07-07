import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireModule } from "@/lib/auth"
import { recomputePreparedIngredientCosts } from "@/lib/recipe-cost"

const ReceiptSchema = z.object({
  lineId: z.string().min(1),
  quantityReceivedDelta: z.number().positive(),
  receivingNote: z.string().optional().nullable(),
})

// I-7: invoice-level adjustment lines confirmed at receive time (auto-attached
// from the vendor's standing VendorAdjustments, editable before saving).
const PoAdjustmentSchema = z.object({
  vendorAdjustmentId: z.string().optional().nullable(),
  name: z.string().min(1),
  type: z.enum(["FLAT", "PERCENT"]),
  value: z.number(),
  amount: z.number(),
  glCode: z.string().optional().nullable(),
})

// Body is either the legacy bare receipts array or
// { receipts, adjustments? } — adjustments replace the PO's set wholesale.
const ReceiveSchema = z.union([
  z.array(ReceiptSchema).min(1),
  z.object({
    receipts: z.array(ReceiptSchema).min(1),
    adjustments: z.array(PoAdjustmentSchema).optional(),
  }),
])

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
  const parsed = ReceiveSchema.parse(body)
  const receipts = Array.isArray(parsed) ? parsed : parsed.receipts
  const adjustments = Array.isArray(parsed) ? undefined : parsed.adjustments

  const linesById = new Map(po.lines.map((l) => [l.id, l]))
  for (const r of receipts) {
    if (!linesById.has(r.lineId)) {
      return NextResponse.json({ error: `Line ${r.lineId} not found on this purchase order` }, { status: 400 })
    }
  }

  const changedCosts: { ingredientId: string; ingredientName: string; oldCost: number; newCost: number }[] = []

  await prisma.$transaction(async (tx) => {
    for (const r of receipts) {
      const line = linesById.get(r.lineId)!
      const quantityReceived = Math.min(line.quantityReceived + r.quantityReceivedDelta, line.quantityOrdered)

      await tx.purchaseOrderLine.update({
        where: { id: r.lineId },
        data: {
          quantityReceived,
          receivedAt: new Date(), // places this received value in the right inventory period (I-5)
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
      const newCostPerReportingUnit = line.unitCost / line.ingredient.unitsPerPurchase
      if (newCostPerReportingUnit !== line.ingredient.costPerReportingUnit) {
        changedCosts.push({
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          oldCost: line.ingredient.costPerReportingUnit,
          newCost: newCostPerReportingUnit,
        })
      }

      await tx.ingredient.update({
        where: { id: line.ingredientId },
        data: {
          purchaseCost: line.unitCost,
          costPerReportingUnit: newCostPerReportingUnit,
          costLogs: { create: { costPerReportingUnit: newCostPerReportingUnit, source: "PO_RECEIPT", sourceRef: po.poNumber } },
        },
      })
    }

    // Replace the PO's adjustment lines with the confirmed set (I-7).
    if (adjustments !== undefined) {
      await tx.purchaseOrderAdjustment.deleteMany({ where: { purchaseOrderId: id } })
      if (adjustments.length > 0) {
        await tx.purchaseOrderAdjustment.createMany({
          data: adjustments.map((a) => ({
            purchaseOrderId: id,
            vendorAdjustmentId: a.vendorAdjustmentId ?? null,
            name: a.name,
            type: a.type,
            value: a.value,
            amount: a.amount,
            glCode: a.glCode ?? null,
          })),
        })
      }
    }

    const freshLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } })
    const allFull = freshLines.every((l) => l.quantityReceived >= l.quantityOrdered)
    const anyReceived = freshLines.some((l) => l.quantityReceived > 0)

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: allFull ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status,
        ...(allFull && !po.receivedAt ? { receivedAt: new Date() } : {}),
      },
    })
  })

  // Ripple the new costs into prepared (batch) ingredients so recipes that use
  // them, and future counts, see the receipt price at any nesting depth.
  if (changedCosts.length > 0) await recomputePreparedIngredientCosts(org.id)

  const updated = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { ingredient: true } }, store: true, vendor: true, adjustments: true },
  })

  return NextResponse.json({ ...updated, changedCosts })
}
