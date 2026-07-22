import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../access"

const bodySchema = z.object({
  staffMemberId: z.string().min(1),
  trainingModuleIds: z.array(z.string().min(1)).min(1).max(100),
  trainerUserId: z.string().min(1).nullish(),
  dueDate: z.string().datetime().nullish(),
})

// POST /api/hr/training/assignments — assign module(s) to a staff member.
// ADMIN org-wide; MANAGER for staff in their stores. Already-assigned modules
// are skipped, not duplicated: an assignment is one staff member's run
// through a module and accumulates records.
export async function POST(req: Request) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { staffMemberId, trainingModuleIds, trainerUserId, dueDate } = parsed.data

  const member = await findManageableStaffMember(staffMemberId, access)
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (member.status !== "ACTIVE") {
    return NextResponse.json({ error: "Cannot assign training to a terminated staff member" }, { status: 409 })
  }

  // Org-scope the modules; a foreign or archived module id is silently
  // dropped rather than assigned.
  const modules = await prisma.trainingModule.findMany({
    where: { id: { in: trainingModuleIds }, organizationId: access.org.id, isArchived: false },
    select: { id: true },
  })

  if (trainerUserId) {
    const trainer = await prisma.user.findFirst({
      where: { id: trainerUserId, organizationId: access.org.id, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true },
    })
    if (!trainer) return NextResponse.json({ error: "Trainer not found" }, { status: 400 })
  }

  const existing = await prisma.trainingAssignment.findMany({
    where: { staffMemberId, trainingModuleId: { in: modules.map((m) => m.id) } },
    select: { trainingModuleId: true },
  })
  const alreadyAssigned = new Set(existing.map((a) => a.trainingModuleId))
  const toCreate = modules.filter((m) => !alreadyAssigned.has(m.id))

  await prisma.trainingAssignment.createMany({
    data: toCreate.map((m) => ({
      trainingModuleId: m.id,
      staffMemberId,
      assignedByUserId: access.dbUser.id,
      trainerUserId: trainerUserId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
    })),
  })

  return NextResponse.json({ created: toCreate.length, skipped: alreadyAssigned.size }, { status: 201 })
}
