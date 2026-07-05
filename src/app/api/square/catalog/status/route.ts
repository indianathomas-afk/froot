import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireModule } from "@/lib/auth"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const [categories, items, variations] = await Promise.all([
    prisma.catalogCategory.count({ where: { organizationId: org.id, isDeleted: false } }),
    prisma.catalogItem.count({ where: { organizationId: org.id, isDeleted: false } }),
    prisma.catalogItemVariation.count({ where: { catalogItem: { organizationId: org.id, isDeleted: false } } }),
  ])

  return NextResponse.json({
    lastCatalogSyncAt: org.lastCatalogSyncAt,
    categories,
    items,
    variations,
  })
}
