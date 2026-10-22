import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"
import { setMilestoneEligible } from "@/lib/milestone-eligibility"

// MS-6 — PUT /api/staff/[id]/milestone-eligibility. The MILESTONES switch on
// the /settings/labor Positions table (Gary, 2026-10-21, R1–R8).
//
// THE GATES, IN THIS ORDER:
//   1. requireMilestones("milestones.manage") — Milestones off = 404 to
//      everyone, ADMIN included; MANAGER, STORE and STAFF = 403 (R4).
//   2. The member, by id AND this org — another org's id is a 404. Keyed by
//      StaffMember.id, so a "Not in Froot" roster row (no StaffMember) has
//      nothing to address and cannot be set (R7), and one person is one row
//      whichever store's roster the switch was flipped on (R6).
//
// Shape follows the CONFID. switch's route (PATCH
// /api/square/labor/roster/[id]): Zod body, org-scoped lookup, the flag echoed
// back so the card can confirm the save rather than assume it. Unlike that
// route this one writes an AuditLog row (who, member, before → after).

const putSchema = z.object({ milestoneEligible: z.boolean() })

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) {
    return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })
  }

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const { id } = await params
  const { userId } = await auth()
  const result = await setMilestoneEligible({
    organizationId: access.org.id,
    staffMemberId: id,
    milestoneEligible: parsed.data.milestoneEligible,
    actorUserId: userId ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  return NextResponse.json({ milestoneEligible: result.milestoneEligible })
}
