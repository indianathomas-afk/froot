import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../../access"

// Shared resolver: assignment → org + manager store scope via its staff
// member. Returns null when out of reach (caller 404s).
async function findManageableAssignment(
  id: string,
  access: { org: { id: string }; isAdmin: boolean; storeIds: string[] }
) {
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id, trainingModule: { organizationId: access.org.id } },
    include: { _count: { select: { lessonProgress: true, quizAttempts: true } } },
  })
  if (!assignment) return null
  const member = await findManageableStaffMember(assignment.staffMemberId, access)
  if (!member) return null
  return assignment
}

const patchSchema = z.object({
  trainerUserId: z.string().min(1).nullish(),
  dueDate: z.string().datetime().nullish(),
  hoursLogged: z.number().min(0).max(1000).nullish(),
})

// PATCH /api/hr/training/assignments/[id] — assignment metadata only
// (trainer, due date, logged hours). Progress, attempts, and certification
// fields are never writable here: those move through their own append-only
// capture routes.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const assignment = await findManageableAssignment(id, access)
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { trainerUserId, dueDate, hoursLogged } = parsed.data

  if (trainerUserId) {
    const trainer = await prisma.user.findFirst({
      where: { id: trainerUserId, organizationId: access.org.id, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true },
    })
    if (!trainer) return NextResponse.json({ error: "Trainer not found" }, { status: 400 })
  }

  const updated = await prisma.trainingAssignment.update({
    where: { id },
    data: {
      ...(trainerUserId !== undefined ? { trainerUserId } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      ...(hoursLogged !== undefined ? { hoursLogged } : {}),
    },
  })
  return NextResponse.json({ id: updated.id, hoursLogged: updated.hoursLogged })
}

// DELETE /api/hr/training/assignments/[id] — mistake correction only: an
// assignment with ANY progress, quiz attempts, or a certificate is a record
// and is never deleted (rule 4).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const assignment = await findManageableAssignment(id, access)
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  if (
    assignment._count.lessonProgress > 0 ||
    assignment._count.quizAttempts > 0 ||
    assignment.certifiedAt !== null ||
    assignment.certPdfPathname !== null
  ) {
    return NextResponse.json(
      { error: "This assignment has progress records and cannot be removed" },
      { status: 409 }
    )
  }

  await prisma.trainingAssignment.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
