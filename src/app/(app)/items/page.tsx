import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Package } from "lucide-react"
import Link from "next/link"
import { ItemsClient } from "./items-client"

async function getData(organizationId: string) {
  const [categories, items, metadata] = await Promise.all([
    prisma.catalogCategory.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.catalogItem.findMany({
      where: { organizationId, isDeleted: false },
      include: { variations: { orderBy: { ordinal: "asc" } }, category: true },
      orderBy: { name: "asc" },
    }),
    prisma.itemMetadata.findMany({ where: { organizationId } }),
  ])

  return { categories, items, metadata }
}

export default async function ItemsPage() {
  const { orgId, userId } = await auth()
  if (!orgId) redirect("/dashboard")

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) redirect("/dashboard")

  if (!org.activeModules.includes("inventory")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
            <Package className="h-6 w-6 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-2">Inventory Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
            Sync your Square catalog, track vendor costs and par levels, and run physical counts —
            upgrade to the Inventory add-on to unlock this page.
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
  const { categories, items, metadata } = await getData(org.id)

  const metadataBySquareId = new Map(metadata.map((m) => [m.squareCatalogObjId, m]))

  const itemsForClient = items.map((item) => {
    const squareCatalogObjId = item.squareItemId ?? item.id
    return {
      id: item.id,
      squareCatalogObjId,
      name: item.name,
      description: item.description,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
      isArchived: item.isArchived,
      productType: item.productType,
      variations: item.variations.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        priceMoney: v.priceMoney,
        ordinal: v.ordinal,
      })),
      metadata: metadataBySquareId.get(squareCatalogObjId) ?? null,
    }
  })

  return (
    <ItemsClient
      items={itemsForClient}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      isAdmin={dbUser?.role === "ADMIN"}
      lastCatalogSyncAt={org.lastCatalogSyncAt?.toISOString() ?? null}
      squareConnected={!!org.squareAccessToken}
    />
  )
}
