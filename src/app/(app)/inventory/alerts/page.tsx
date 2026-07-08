import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { BellRing } from "lucide-react"
import Link from "next/link"
import { getUserStoreScope } from "@/lib/auth"
import { AlertsClient } from "./alerts-client"

export default async function InventoryAlertsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <BellRing className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Low-Stock Alerts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Get flagged the moment expected inventory drops below your reorder points, with suggested order quantities.
            Upgrade to the Inventory add-on to unlock this page.
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
  const role = dbUser?.role ?? "STAFF"
  if (role !== "ADMIN" && role !== "MANAGER") redirect("/dashboard")

  const { isAdmin, storeIds } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, isActive: true, ...(isAdmin ? {} : { id: { in: storeIds } }) },
    orderBy: { name: "asc" },
  })

  return <AlertsClient stores={stores.map((s) => ({ id: s.id, name: s.name }))} />
}
