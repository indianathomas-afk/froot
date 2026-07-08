import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import { getUserStoreScope } from "@/lib/auth"
import { PurchaseOrderDetailClient } from "./po-detail-client"

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) redirect("/inventory/purchase-orders")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const { isAdmin, storeIds } = await getUserStoreScope()

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: org.id, ...(isAdmin ? {} : { storeId: { in: storeIds } }) },
    include: {
      lines: { include: { ingredient: true } },
      store: true,
      vendor: { include: { adjustments: { where: { isActive: true }, orderBy: { createdAt: "asc" } } } },
      adjustments: { orderBy: { createdAt: "asc" } },
    },
  })
  if (!po) notFound()

  // Vendor prices on file — the receive flow compares the received unit cost
  // against these for the "price changed, update going forward?" confirm.
  const vendorPrices = await prisma.vendorIngredient.findMany({
    where: { vendorId: po.vendorId, ingredientId: { in: po.lines.map((l) => l.ingredientId) } },
    select: { ingredientId: true, casePrice: true },
  })
  const casePriceByIngredient = new Map(vendorPrices.map((v) => [v.ingredientId, v.casePrice]))

  const canManage = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  return (
    <PurchaseOrderDetailClient
      po={{
        ...po,
        expectedAt: po.expectedAt?.toISOString() ?? null,
        orderedAt: po.orderedAt?.toISOString() ?? null,
        createdAt: po.createdAt.toISOString(),
        lines: po.lines.map((l) => ({
          id: l.id,
          ingredientId: l.ingredientId,
          ingredientName: l.ingredientName,
          purchaseUnitLabel: l.ingredient.purchaseUnitLabel,
          quantityOrdered: l.quantityOrdered,
          quantityReceived: l.quantityReceived,
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
          receivingNote: l.receivingNote,
          vendorCasePrice: casePriceByIngredient.get(l.ingredientId) ?? null,
        })),
        adjustments: po.adjustments.map((a) => ({
          id: a.id,
          vendorAdjustmentId: a.vendorAdjustmentId,
          name: a.name,
          type: a.type,
          value: a.value,
          amount: a.amount,
          glCode: a.glCode,
        })),
        vendor: {
          name: po.vendor.name,
          activeAdjustments: po.vendor.adjustments.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            value: a.value,
            glCode: a.glCode,
          })),
        },
      }}
      canManage={canManage}
    />
  )
}
