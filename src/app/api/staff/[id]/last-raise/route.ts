import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { displayTimeZone } from "@/lib/hr"
import { localDateStr } from "@/lib/reports"
import { isValidDateStr } from "@/lib/milestones"
import { laborOverlayOn } from "@/lib/labor-dashboard"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"
import { getRaiseDetailVisibility, setLastRaiseDate } from "@/lib/raise-history"

// MS-3b (F6, F15) — PUT / DELETE /api/staff/[id]/last-raise. An ADMIN sets or
// clears a member's manual "last raise date", for a raise Froot did not see in
// Square. The raise cooldown counts from the LATER of this and the last raise
// detected in the wage history.
//
// THE GATES, IN THIS ORDER:
//   1. requireMilestones("milestones.manage") — Milestones off = 404 to
//      everyone (ADMIN included); MANAGER, STORE and STAFF = 403. A MANAGER may
//      not reset anyone's raise clock (F15), in scope or not.
//   2. The member, by id AND this org — another org's id is a 404.
//   3. The Square labor overlay off = 404: there is no raise feature without it
//      (F12), so there is nothing to set.
//   4. The date is PAY DATA (F10): an ADMIN who may not see this member's pay
//      (canSeeWages, then COMP-1 — getRaiseDetailVisibility) gets a 403. Nobody
//      writes a value they could not be shown.
//   5. PUT body: a real yyyy-mm-dd, not after the member's store-local today.
//
// The response carries the date the caller just sent and nothing else — no
// detected raise, no rate.

const putSchema = z.object({ date: z.string().max(10) })

type Ctx = { params: Promise<{ id: string }> }

async function gate(ctx: Ctx) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) {
    return { error: NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) }) }
  }
  const { id } = await ctx.params
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: access.org.id } })
  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    select: {
      id: true,
      squareTeamMemberId: true,
      isCorporate: true,
      storeAssignments: { select: { isPrimary: true, store: { select: { timezone: true, name: true } } } },
    },
  })
  if (!member) return { error: NextResponse.json({ error: "Staff member not found" }, { status: 404 }) }
  if (!laborOverlayOn(org)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  const visible = await getRaiseDetailVisibility(org, access.actor, [member])
  if (!visible.has(member.id)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  const { dbUser } = await getCurrentUser()
  if (!dbUser) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { org, member, userId: dbUser.id }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ("error" in g) return g.error

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !isValidDateStr(parsed.data.date)) {
    return NextResponse.json({ error: "Enter a valid date." }, { status: 400 })
  }
  const date = parsed.data.date
  if (date > localDateStr(new Date(), displayTimeZone(g.member, g.org))) {
    return NextResponse.json({ error: "The last raise date can't be in the future." }, { status: 400 })
  }

  const result = await setLastRaiseDate(g.org.id, g.member.id, date, g.userId)
  if (!result.ok) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  return NextResponse.json({ success: true, lastRaiseDate: date })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ("error" in g) return g.error

  const result = await setLastRaiseDate(g.org.id, g.member.id, null, g.userId)
  if (!result.ok) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}
