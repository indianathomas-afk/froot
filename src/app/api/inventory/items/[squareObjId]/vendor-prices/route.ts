import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireModule } from "@/lib/auth"

export async function GET(_: Request, { params }: { params: Promise<{ squareObjId: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const { squareObjId } = await params

  const vendorItems = await prisma.vendorItem.findMany({
    where: { squareCatalogObjId: squareObjId, vendor: { organizationId: org.id, isActive: true } },
    include: { vendor: true },
  })

  const withUnitCost = vendorItems.map((vi) => ({
    ...vi,
    perUnitCost:
      vi.lastCasePrice != null
        ? vi.unitsPerCase && vi.unitsPerCase > 0
          ? vi.lastCasePrice / vi.unitsPerCase
          : vi.lastCasePrice
        : null,
  }))

  const cheapestCost = withUnitCost.reduce<number | null>((min, vi) => {
    if (vi.perUnitCost == null) return min
    if (min == null || vi.perUnitCost < min) return vi.perUnitCost
    return min
  }, null)

  const result = withUnitCost.map((vi) => ({
    ...vi,
    isCheapest: cheapestCost != null && vi.perUnitCost === cheapestCost,
  }))

  return NextResponse.json(result)
}
