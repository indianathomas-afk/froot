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
    include: { lines: true, store: true, vendor: true },
  })
  if (!po) notFound()

  const canManage = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  return (
    <PurchaseOrderDetailClient
      po={{
        ...po,
        expectedAt: po.expectedAt?.toISOString() ?? null,
        orderedAt: po.orderedAt?.toISOString() ?? null,
        createdAt: po.createdAt.toISOString(),
      }}
      canManage={canManage}
    />
  )
}
