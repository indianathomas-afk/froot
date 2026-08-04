import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { adjustmentRouteContext } from "@/lib/adjustments"
import { can } from "@/lib/permissions"

// Previously used custom destinations ("Kitchen", "Catering — Smith wedding")
// for the transfer form's suggestions.
export async function GET() {
  const ctx = await adjustmentRouteContext()
  if (ctx.fail) return ctx.fail
  const { org } = ctx

  // Operational: destination suggestions for the transfer form (PERM-2 §3 #5).
  if (!can(ctx.actor, "inventory.adjustments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const groups = await prisma.adjustmentGroup.findMany({
    where: { organizationId: org.id, type: "TRANSFER", destinationLabel: { not: null } },
    select: { destinationLabel: true },
    distinct: ["destinationLabel"],
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return NextResponse.json(groups.map((g) => g.destinationLabel).filter(Boolean))
}
