import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { StoreViewClient } from "./store-view-client"

async function getStores() {
  const { orgId } = await auth()
  if (!orgId) return []
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return []

  const { isAdmin, storeIds } = await getUserStoreScope()
  return prisma.store.findMany({
    where: isAdmin
      ? { organizationId: org.id, isActive: true }
      : { organizationId: org.id, isActive: true, id: { in: storeIds } },
    orderBy: { name: "asc" },
  })
}

export default async function StoreViewPage() {
  const stores = await getStores()
  const { isAdmin } = await getUserStoreScope()
  // A non-admin user with exactly one assigned store skips the picker entirely.
  const autoStoreId = !isAdmin && stores.length === 1 ? stores[0].id : null
  return <StoreViewClient stores={stores} autoStoreId={autoStoreId} />
}
