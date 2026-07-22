import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { quizQuestionSchema } from "@/app/api/hr/training/schemas"
import {
  countObjectiveCorrect,
  recalcAssignmentStatus,
  type QuizAnswerValue,
} from "@/lib/training"
import { findManageableStaffMember, requireHrTrainingManageAccess } from "../../../../../access"

const bodySchema = z.object({
  // Which written questions the trainer marked correct; the rest count wrong.
  writtenCorrectQuestionIds: z.array(z.string()).max(200),
})

// POST /api/hr/training/assignments/[id]/attempts/[attemptId]/review — HR-7
// trainer grading of written answers. The objective half is re-derived from
// the attempt's own snapshot (never the live quiz), the trainer's written
// marks are added, and the final score grades against the snapshotted
// threshold. Once-only while PendingReview — the attempt is append-only
// otherwise.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; attemptId: string }> }
) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const { id, attemptId } = await params
  const attempt = await prisma.trainingQuizAttempt.findFirst({
    where: {
      id: attemptId,
      trainingAssignmentId: id,
      trainingAssignment: { trainingModule: { organizationId: access.org.id } },
    },
    include: { trainingAssignment: { select: { staffMemberId: true } } },
  })
  if (!attempt) return NextResponse.json({ error: "Attempt not found" }, { status: 404 })

  const member = await findManageableStaffMember(attempt.trainingAssignment.staffMemberId, access)
  if (!member) return NextResponse.json({ error: "Attempt not found" }, { status: 404 })

  if (attempt.status !== "PendingReview") {
    return NextResponse.json({ error: "This attempt is not waiting on review" }, { status: 409 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })

  const questions = z.array(quizQuestionSchema).safeParse(attempt.questionsSnapshot)
  if (!questions.success) {
    return NextResponse.json({ error: "Attempt snapshot is unreadable" }, { status: 500 })
  }
  const answers = (attempt.answers ?? {}) as Record<string, QuizAnswerValue>

  const { objectiveCorrect, writtenQuestionIds } = countObjectiveCorrect(questions.data, answers)
  const writtenSet = new Set(writtenQuestionIds)
  const marked = parsed.data.writtenCorrectQuestionIds.filter((qid) => writtenSet.has(qid))
  const writtenCorrect = new Set(marked).size

  const total = questions.data.length
  const scorePct = total > 0 ? Math.round(((objectiveCorrect + writtenCorrect) / total) * 100) : 100
  const status = scorePct >= attempt.passThresholdSnapshot ? "Passed" : "Failed"

  // Once-only: the PendingReview guard makes a concurrent review lose cleanly.
  const { count } = await prisma.trainingQuizAttempt.updateMany({
    where: { id: attempt.id, status: "PendingReview" },
    data: { scorePct, status, reviewedByUserId: access.dbUser.id, reviewedAt: new Date() },
  })
  if (count === 0) {
    return NextResponse.json({ error: "This attempt is not waiting on review" }, { status: 409 })
  }

  const assignmentStatus = await recalcAssignmentStatus(id)
  return NextResponse.json({ scorePct, attemptStatus: status, status: assignmentStatus })
}
