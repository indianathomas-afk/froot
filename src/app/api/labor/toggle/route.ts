import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin, laborModuleAvailable } from "@/lib/auth"
import { seedDefaultLaborPositions, seedDefaultLaborDayparts } from "@/lib/labor-positions"

const bodySchema = z.object({ enabled: z.boolean() })

// Flips "labor" in the org's activeModules (Instagram/HR-toggle pattern).
// ADMIN-only, like the HR add-on toggle — enabling an add-on is a billing-
// adjacent action (settings/position/forecast EDITING is ADMIN+MANAGER, but
// that lives on /settings/labor, not here). Behind the availability gate:
// where Labor doesn't exist, this endpoint doesn't either. On first enable we
// seed the default rate legend so the org starts usable (idempotent).
export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!laborModuleAvailable(orgId)) {
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

  const activeModules = parsed.data.enabled
    ? [...new Set([...org.activeModules, "labor"])]
    : org.activeModules.filter((m) => m !== "labor")

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { activeModules },
  })

  // Seed defaults on enable so a fresh org isn't staring at an empty legend.
  if (parsed.data.enabled) {
    await seedDefaultLaborPositions(org.id)
    await seedDefaultLaborDayparts(org.id)
  }

  return NextResponse.json({ enabled: updated.activeModules.includes("labor") })
}
