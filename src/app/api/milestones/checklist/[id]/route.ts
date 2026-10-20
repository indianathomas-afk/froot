import { NextResponse } from "next/server"
import { z } from "zod"
import { checklistMilestonesEnabled, updateChecklistMilestone } from "@/lib/milestones-db"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"
import { checklistFieldsSchema } from "@/lib/milestones"

// MS-4a — edit, archive or restore one checklist milestone. milestones.manage,
// and 404 while the F13 switch is off (see ../route.ts). ARCHIVE, NEVER DELETE —
// no DELETE handler, as for tenure.
const patchSchema = checklistFieldsSchema.partial().extend({ isArchived: z.boolean().optional() })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })
  if (!(await checklistMilestonesEnabled(access.org.id))) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const { id } = await params
  const result = await updateChecklistMilestone(access.org.id, id, parsed.data)

  if (result === "not-found") return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (result === "clash") {
    return NextResponse.json({ error: "Another milestone already uses that number of tasks" }, { status: 409 })
  }
  return NextResponse.json(result)
}
