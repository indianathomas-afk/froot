import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { MessagesClient } from "./messages-client"

// Team Messages hub (Phase I-14) — store feed, typed composer, reactions,
// corporate updates. Store selection shares the dashboard's localStorage key
// so clicking through from the dashboard keeps the same store.

export default async function MessagesPage() {
  const { orgId } = await auth()
  if (!orgId) return null

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return null

  const { isAdmin, storeIds, role } = await getUserStoreScope()

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  return (
    <MessagesClient
      stores={stores}
      role={role ?? "STAFF"}
      inventoryActive={org.activeModules.includes("inventory")}
    />
  )
}
