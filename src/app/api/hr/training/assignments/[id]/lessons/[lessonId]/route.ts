import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recalcAssignmentStatus } from "@/lib/training"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../../../../access"

// POST /api/hr/training/assignments/[id]/lessons/[lessonId] — HR-7 route (B):
// manager-attested lesson completion for staff without a login. Writes one
// TrainingLessonProgress with authMethod=ManagerAttested and the attesting
// manager's user id. Append-only and idempotent: an already-completed lesson
// is skipped, never overwritten (a ClerkSession completion is never
// downgraded to an attested one).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id, lessonId } = await params
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id, trainingModule: { organizationId: access.org.id } },
    select: { id: true, staffMemberId: true, trainingModuleId: true },
  })
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const member = await findManageableStaffMember(assignment.staffMemberId, access)
  if (!member) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
  if (member.status !== "ACTIVE") {
    return NextResponse.json({ error: "Staff member is terminated" }, { status: 409 })
  }

  // The lesson must belong to the assignment's module.
  const lesson = await prisma.trainingLesson.findFirst({
    where: { id: lessonId, trainingModuleId: assignment.trainingModuleId },
    select: { id: true },
  })
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 })

  const created = await prisma.trainingLessonProgress.createMany({
    data: [
      {
        trainingAssignmentId: assignment.id,
        trainingLessonId: lesson.id,
        completedByStaffId: member.id,
        authMethod: "ManagerAttested",
        completedByUserId: access.dbUser.id,
      },
    ],
    skipDuplicates: true,
  })

  const status = await recalcAssignmentStatus(assignment.id)
  return NextResponse.json({ completed: created.count > 0, status }, { status: created.count > 0 ? 201 : 200 })
}
