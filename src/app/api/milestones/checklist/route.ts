import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checklistMilestonesEnabled, createChecklistMilestone } from "@/lib/milestones-db"
import { checklistFieldsSchema } from "@/lib/milestones"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"

// MS-4a — the org's checklist milestones (F0: thresholds are NAMED TASKS).
// GET lists them, archived included; POST creates one. Both milestones.manage
// (ADMIN_ONLY), like /api/milestones/tenure.
//
// TWO GATES: the Milestones module (404 to everyone while off), then the F13
// "Checklist milestones" switch — off means the setup section shows only the
// switch (Gary, 2026-10-17), so these answer 404 too rather than accept rows
// nobody can see.

async function gate() {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) {
    return { res: NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) }) }
  }
  if (!(await checklistMilestonesEnabled(access.org.id))) {
    return { res: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  return { access }
}

export async function GET() {
  const { access, res } = await gate()
  if (!access) return res

  const rows = await prisma.checklistMilestone.findMany({
    where: { organizationId: access.org.id },
    orderBy: [{ isArchived: "asc" }, { taskCount: "asc" }],
  })
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const { access, res } = await gate()
  if (!access) return res

  const parsed = checklistFieldsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const result = await createChecklistMilestone(access.org.id, parsed.data)
  if (result === "clash") {
    return NextResponse.json({ error: "Another milestone already uses that number of tasks" }, { status: 409 })
  }
  return NextResponse.json(result, { status: 201 })
}
