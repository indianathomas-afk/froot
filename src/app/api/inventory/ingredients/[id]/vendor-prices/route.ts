import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { requireModule } from "@/lib/auth"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const { id } = await params

  const vendorIngredients = await prisma.vendorIngredient.findMany({
    where: { ingredientId: id, vendor: { organizationId: org.id, isActive: true } },
    include: { vendor: true },
  })

  const withUnitCost = vendorIngredients.map((vi) => ({
    ...vi,
    costPerReportingUnit:
      vi.casePrice != null
        ? vi.unitsPerCase && vi.unitsPerCase > 0
          ? vi.casePrice / vi.unitsPerCase
          : vi.casePrice
        : null,
  }))

  const cheapestCost = withUnitCost.reduce<number | null>((min, vi) => {
    if (vi.costPerReportingUnit == null) return min
    if (min == null || vi.costPerReportingUnit < min) return vi.costPerReportingUnit
    return min
  }, null)

  const result = withUnitCost.map((vi) => ({
    ...vi,
    isCheapest: cheapestCost != null && vi.costPerReportingUnit === cheapestCost,
  }))

  return NextResponse.json(result)
}
