import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { StoreViewClient } from "./store-view-client"

async function getStores() {
  const { orgId } = await auth()
  if (!orgId) return []
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return []
  return prisma.store.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { name: "asc" },
  })
}

export default async function StoreViewPage() {
  const stores = await getStores()
  return <StoreViewClient stores={stores} />
}
