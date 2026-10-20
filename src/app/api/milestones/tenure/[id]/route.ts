import { NextResponse } from "next/server"
import { z } from "zod"
import { updateTenureMilestone } from "@/lib/milestones-db"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"
import { tenureFieldsSchema } from "@/lib/milestones"

// MS-1 — edit, archive or restore one tenure milestone. milestones.manage.
//
// ARCHIVE, NEVER DELETE. An archived milestone stops counting everywhere
// (achieved and upcoming are computed from active rows only) and can be
// restored. There is no DELETE handler on purpose.
const patchSchema = tenureFieldsSchema.partial().extend({ isArchived: z.boolean().optional() })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const { id } = await params
  const result = await updateTenureMilestone(access.org.id, id, parsed.data)

  if (result === "not-found") return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (result === "clash") {
    return NextResponse.json({ error: "Another milestone already uses that number of days" }, { status: 409 })
  }
  return NextResponse.json(result)
}
