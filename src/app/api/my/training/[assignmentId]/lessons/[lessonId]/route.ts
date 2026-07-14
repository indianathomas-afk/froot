import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { recalcAssignmentStatus } from "@/lib/training"

// POST /api/my/training/[assignmentId]/lessons/[lessonId] — HR-7 route (A):
// a staff member completes one of THEIR OWN assigned lessons. Rule 3: the
// assignment is resolved against the session's staff profile — a foreign
// assignment id 404s. Rule 1: getActiveStaffSelf requires ACTIVE. Append-only
// and idempotent like the attested twin.
export async function POST(_req: Request, { params }: { params: Promise<{ assignmentId: string; lessonId: string }> }) {
  const self = await getActiveStaffSelf()
  if (!self.ok) {
    const status = self.reason === "unauthenticated" ? 401 : self.reason === "unavailable" ? 404 : 403
    return NextResponse.json({ error: "Not available" }, { status })
  }

  const { assignmentId, lessonId } = await params
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id: assignmentId, staffMemberId: self.staffMember.id },
    select: { id: true, trainingModuleId: true },
  })
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

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
        completedByStaffId: self.staffMember.id,
        authMethod: "ClerkSession",
      },
    ],
    skipDuplicates: true,
  })

  const status = await recalcAssignmentStatus(assignment.id)
  return NextResponse.json({ completed: created.count > 0, status }, { status: created.count > 0 ? 201 : 200 })
}
