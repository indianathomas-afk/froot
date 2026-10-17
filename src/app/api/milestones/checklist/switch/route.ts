import { NextResponse } from "next/server"
import { z } from "zod"
import { setChecklistMilestonesEnabled } from "@/lib/milestones-db"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"

// MS-4a F13 (Gary, 2026-10-17) — the "Checklist milestones" switch on
// /staff/milestones: "OFF by default, independent of the main Milestones
// toggle". milestones.manage (ADMIN_ONLY). Behind the Milestones module gate
// like every milestone route, so with Milestones off this is 404 — the switch
// is a setting INSIDE Milestones, not a way to reach it.
//
// Turning it off archives nothing and deletes nothing: the milestones simply
// stop showing, and come back as they were when it is turned on again.

const bodySchema = z.object({ enabled: z.boolean() })

export async function PUT(req: Request) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  await setChecklistMilestonesEnabled(access.org.id, parsed.data.enabled)
  return NextResponse.json({ enabled: parsed.data.enabled })
}
