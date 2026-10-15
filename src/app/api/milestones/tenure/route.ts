import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createTenureMilestone } from "@/lib/milestones-db"
import { tenureFieldsSchema } from "@/lib/milestones"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"

// MS-1 — the org's tenure milestones. GET lists them (archived included, so the
// setup page can restore one); POST creates one. BOTH ARE milestones.manage
// (ADMIN_ONLY, not grantable): the list is the setup page's data, and the
// Milestones tab on /staff/[id] reads the table server-side, not through here.
//
// Off (HR unavailable, HR off, or the toggle off) = 404 to everyone — see
// src/lib/milestones-access.ts.

export async function GET() {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  const rows = await prisma.tenureMilestone.findMany({
    where: { organizationId: access.org.id },
    orderBy: [{ isArchived: "asc" }, { dayCount: "asc" }],
  })
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  const parsed = tenureFieldsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  // Duplicate dayCount among active rows → 409 (rule and reasons in
  // src/lib/milestones-db.ts).
  const result = await createTenureMilestone(access.org.id, parsed.data)
  if (result === "clash") {
    return NextResponse.json({ error: "Another milestone already uses that number of days" }, { status: 409 })
  }
  return NextResponse.json(result, { status: 201 })
}
