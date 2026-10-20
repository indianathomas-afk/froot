import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"

// PUT /api/milestone-alerts/settings — MS-4b, the org's milestone email switch
// (F10, Gary 2026-10-17: "org-level milestone email switch, off by default").
// Writes Organization.milestoneAlertsEnabled. Shaped on
// PUT /api/pace-alerts/settings.
//
// GATES, IN ORDER: Milestones itself (requireMilestones — HR available, HR on,
// milestones on; off is 404 to everyone, ADMIN included, the MS-1 rule), then
// ADMIN-only (403), because turning on email to every manager is an
// org-governance action. The card on /settings/notifications is already behind
// settings.access; this re-checks per PERM-2.
//
// NOTHING IS SEEDED OR CLEARED ON EITHER EDGE. Turning it on writes nothing:
// the next 15:00 UTC run records old milestones as known and sends the last 7
// days (ruling 2). Turning it off expires queued milestone intents at their
// next dispatch; a sent milestone stays sent across any number of toggles.

const bodySchema = z.object({ enabled: z.boolean() })

export async function PUT(req: Request) {
  const access = await requireMilestones()
  if (!access.ok) {
    return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })
  }
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const updated = await prisma.organization.update({
    where: { id: access.org.id },
    data: { milestoneAlertsEnabled: parsed.data.enabled },
    select: { milestoneAlertsEnabled: true },
  })
  return NextResponse.json({ enabled: updated.milestoneAlertsEnabled })
}
