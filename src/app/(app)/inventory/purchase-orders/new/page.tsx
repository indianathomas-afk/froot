import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { getUserStoreScope } from "@/lib/auth"
import { NewPurchaseOrderClient } from "./new-po-client"

export default async function NewPurchaseOrderPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) redirect("/inventory/purchase-orders")

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  if (dbUser?.role !== "ADMIN" && dbUser?.role !== "MANAGER") redirect("/inventory/purchase-orders")

  const { isAdmin, storeIds } = await getUserStoreScope()

  const [stores, vendors, catalogItems, metadata] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId: org.id, ...(isAdmin ? {} : { id: { in: storeIds } }) },
      orderBy: { name: "asc" },
    }),
    prisma.vendor.findMany({ where: { organizationId: org.id, isActive: true }, orderBy: { name: "asc" } }),
    prisma.catalogItem.findMany({
      where: { organizationId: org.id, isDeleted: false },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.itemMetadata.findMany({ where: { organizationId: org.id } }),
  ])

  const metadataBySquareId = new Map(metadata.map((m) => [m.squareCatalogObjId, m]))

  const items = catalogItems.map((item) => {
    const squareCatalogObjId = item.squareItemId ?? item.id
    const meta = metadataBySquareId.get(squareCatalogObjId)
    return {
      squareCatalogObjId,
      name: item.name,
      categoryName: item.category?.name ?? null,
      unitOfMeasure: meta?.unitOfMeasure ?? null,
      unitCostOverride: meta?.unitCostOverride ?? null,
    }
  })

  return (
    <NewPurchaseOrderClient
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
      items={items}
    />
  )
}
