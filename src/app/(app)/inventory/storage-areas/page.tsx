import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Warehouse } from "lucide-react"
import Link from "next/link"
import { getUserStoreScope } from "@/lib/auth"
import { StorageAreasClient } from "./storage-areas-client"

export default async function StorageAreasPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <Warehouse className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Inventory Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Organize ingredients into per-store storage areas so physical counts walk the room fast — upgrade to the
            Inventory add-on to unlock this page.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Plan
          </Link>
        </div>
      </div>
    )
  }

  const dbUser = userId ? await prisma.user.findUnique({ where: { clerkUserId: userId } }) : null
  const isAdmin = dbUser?.role === "ADMIN"
  const canManage = isAdmin || dbUser?.role === "MANAGER"

  const { storeIds } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
  })

  return (
    <StorageAreasClient
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      canManage={canManage}
      isAdmin={isAdmin}
    />
  )
}
