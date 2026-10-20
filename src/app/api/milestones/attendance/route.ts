import { NextResponse } from "next/server"
import { z } from "zod"
import { getMilestoneSettings, saveMilestoneSettings } from "@/lib/attendance"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"

// MS-2 — the On-Time settings on /staff/milestones: red and green thresholds,
// look-back days, minimum shifts, grace period. BOTH METHODS ARE
// milestones.manage (ADMIN_ONLY, not grantable), like every MS-1 milestone
// route. The badges themselves never read through here — /staff and
// /staff/[id] compute them server-side.
//
// Off (HR unavailable, HR off, or the Milestones toggle off) = 404 to everyone,
// ADMIN included — src/lib/milestones-access.ts.
//
// The Square labor overlay being off is NOT a 404 here: an admin may set the
// thresholds before scheduling is connected (F5); the badges just stay grey.

const bodySchema = z.object({
  onTimeRedBelow: z.number().int(),
  onTimeGreenAtOrAbove: z.number().int(),
  onTimeLookbackDays: z.number().int(),
  onTimeMinShifts: z.number().int(),
  onTimeGraceMinutes: z.number().int(),
})

export async function GET() {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  return NextResponse.json(await getMilestoneSettings(access.org.id))
}

export async function PUT(req: Request) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  // Bounds, red < green (F8) and the 5/10/15 grace choice (F2) are one
  // validator in src/lib/attendance.ts — a refusal is a 400 with its sentence.
  const result = await saveMilestoneSettings(access.org.id, parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.settings)
}
