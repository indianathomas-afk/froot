import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recalcAssignmentStatus, requestIp } from "@/lib/training"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../../../access"

const bodySchema = z.object({
  scorePct: z.number().int().min(0).max(100),
})

// POST /api/hr/training/assignments/[id]/quiz-result — HR-7 route (B):
// manager-attested quiz result for staff without a login (quiz administered
// on paper or on the manager's device). Creates an append-only
// TrainingQuizAttempt with the manager-entered score graded against the
// CURRENT quiz's threshold, both snapshotted at capture time — later quiz
// edits never change what this attempt meant. answers stays empty: the
// manager attests the outcome, not the per-question responses.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id, trainingModule: { organizationId: access.org.id } },
    include: { trainingModule: { select: { quizzes: true } } },
  })
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const member = await findManageableStaffMember(assignment.staffMemberId, access)
  if (!member) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
  if (member.status !== "ACTIVE") {
    return NextResponse.json({ error: "Staff member is terminated" }, { status: 409 })
  }

  const quiz = assignment.trainingModule.quizzes[0]
  if (!quiz) return NextResponse.json({ error: "This module has no quiz" }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { scorePct } = parsed.data

  const attempt = await prisma.trainingQuizAttempt.create({
    data: {
      trainingAssignmentId: assignment.id,
      questionsSnapshot: quiz.questions ?? [],
      passThresholdSnapshot: quiz.passThreshold,
      answers: {},
      scorePct,
      status: scorePct >= quiz.passThreshold ? "Passed" : "Failed",
      authMethod: "ManagerAttested",
      attestedByUserId: access.dbUser.id,
      ipAddress: requestIp(req),
      userAgent: req.headers.get("user-agent"),
    },
  })

  const status = await recalcAssignmentStatus(assignment.id)
  return NextResponse.json({ attemptId: attempt.id, attemptStatus: attempt.status, status }, { status: 201 })
}
