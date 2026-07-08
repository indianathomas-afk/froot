import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { adjustmentRouteContext } from "@/lib/adjustments"

// Previously used custom destinations ("Kitchen", "Catering — Smith wedding")
// for the transfer form's suggestions.
export async function GET() {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org } = ctx

  const groups = await prisma.adjustmentGroup.findMany({
    where: { organizationId: org.id, type: "TRANSFER", destinationLabel: { not: null } },
    select: { destinationLabel: true },
    distinct: ["destinationLabel"],
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return NextResponse.json(groups.map((g) => g.destinationLabel).filter(Boolean))
}
