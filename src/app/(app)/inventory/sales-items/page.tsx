import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { ShoppingBag } from "lucide-react"
import Link from "next/link"
import { SalesItemsClient } from "./sales-items-client"

export default async function SalesItemsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <ShoppingBag className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Inventory Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Sync your Square sales items — upgrade to the Inventory add-on to unlock this page.
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

  const salesItems = await prisma.salesItem.findMany({
    where: { organizationId: org.id, isDeleted: false },
    orderBy: [{ menuGroup: "asc" }, { name: "asc" }],
  })

  return (
    <SalesItemsClient
      salesItems={salesItems.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        menuGroup: s.menuGroup,
        priceCents: s.priceCents,
        squareVariationId: s.squareVariationId,
      }))}
      isAdmin={dbUser?.role === "ADMIN"}
      lastCatalogSyncAt={org.lastCatalogSyncAt?.toISOString() ?? null}
      squareConnected={!!org.squareAccessToken}
    />
  )
}
