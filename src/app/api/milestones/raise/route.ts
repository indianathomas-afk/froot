import { NextResponse } from "next/server"
import { z } from "zod"
import { getRaiseSettings, saveRaiseSettings } from "@/lib/raise-eligibility"
import { milestonesDenialBody, milestonesDenialStatus, requireMilestones } from "@/lib/milestones-access"

// MS-3a — the Raise eligibility settings on /staff/milestones: the compliance
// gate (ruling 5), hours per week over consecutive weeks, the on-time minimum,
// the cooldown (ruling 4), and the required trainings and documents. BOTH
// METHODS ARE milestones.manage (ADMIN_ONLY, not grantable), like every MS-1 and
// MS-2 milestone route. The badges never read through here — /staff and
// /staff/[id] compute them server-side.
//
// Off (HR unavailable, HR off, or the Milestones toggle off) = 404 to everyone,
// ADMIN included — src/lib/milestones-access.ts.
//
// The Square labor overlay being off is NOT a 404 here (F12): an admin may set
// the rules before Square labor is connected; no badge shows until it is.
//
// The response carries settings and ids only — no member, no pay.

const id = z.string().min(1).max(64)
const bodySchema = z.object({
  raiseComplianceGate: z.boolean(),
  raiseMinHoursPerWeek: z.number().int(),
  raiseConsecutiveWeeks: z.number().int(),
  raiseMinOnTimePct: z.number().int(),
  raiseCooldownDays: z.number().int(),
  requiredTrainingIds: z.array(id).max(100),
  requiredDocumentIds: z.array(id).max(100),
})

export async function GET() {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  return NextResponse.json(await getRaiseSettings(access.org.id))
}

export async function PUT(req: Request) {
  const access = await requireMilestones("milestones.manage")
  if (!access.ok) return NextResponse.json(milestonesDenialBody(access.reason), { status: milestonesDenialStatus(access.reason) })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  // Bounds, duplicates and "every id is a live training / compliance document
  // in THIS org" are one validator in src/lib/raise-eligibility.ts — a refusal
  // is a 400 with its sentence.
  const result = await saveRaiseSettings(access.org.id, parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.settings)
}
