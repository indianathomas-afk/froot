import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin, laborModuleAvailable, squareLaborAvailable } from "@/lib/auth"

const bodySchema = z.object({ enabled: z.boolean() })

// AL-1 / L-2 seam (a). Flips Organization.squareLaborEnabled — a DEDICATED
// COLUMN, not a fifth entry in activeModules, mirroring /api/instagram/toggle
// rather than /api/labor/toggle. The distinction is the seam's: activeModules is
// the BILLABLE ADD-ON list, and a Square connection is a data source for the
// "Weekly Labor Model" an org already pays for, not a separate purchase.
//
// ADMIN-only. Behind BOTH availability gates plus the Labor add-on: where the
// Labor module doesn't exist, or the Square overlay doesn't exist in this
// environment, or the org has not bought Labor, this endpoint doesn't exist
// either. Checking Labor first makes square-labor-without-labor unreachable.
//
// DELIBERATELY DOES NOT REQUIRE A SQUARE CONNECTION — unlike
// /api/instagram/toggle, which 400s when Instagram is not connected. A Square
// disconnect does not turn this off (Gary, 2026-08-05), so refusing to turn it
// ON while disconnected would be the same rule pointed the wrong way: an admin
// could not pre-arm the overlay before connecting, and a disconnected org that
// flipped it off could not flip it back. The overlay simply reads as unhealthy
// until Square is there.
export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!laborModuleAvailable(orgId) || !squareLaborAvailable(orgId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })
  if (!org.activeModules.includes("labor")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { squareLaborEnabled: parsed.data.enabled },
  })

  // NOTHING IS SEEDED AND NOTHING IS DELETED ON EITHER EDGE. /api/labor/toggle
  // seeds a rate legend on enable because an empty legend is unusable; there is
  // no equivalent here, and turning the overlay OFF must not drop mirrored rows —
  // seam DON'T #4's direction: staleness is a badge, not a delete.
  return NextResponse.json({ enabled: updated.squareLaborEnabled })
}
