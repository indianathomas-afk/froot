import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { quizQuestionSchema } from "@/app/api/hr/training/schemas"
import { gradeQuizAnswers, recalcAssignmentStatus, requestIp } from "@/lib/training"

const bodySchema = z.object({
  answers: z.record(z.string(), z.union([z.string().max(5000), z.array(z.string()).max(50)])),
})

// POST /api/my/training/[assignmentId]/quiz — HR-7 route (A): a staff member
// sits THEIR OWN module quiz. Auto-grades boolean/single/multi against
// correctOptionIds vs passThreshold; any written answer sends the attempt to
// PendingReview for the trainer (never auto-scored) unless the objective
// misses already made passing impossible. Questions + threshold are
// snapshotted so later quiz edits never change what this attempt meant.
// Retakes accumulate append-only; a passed quiz is done — no further sittings.
export async function POST(req: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const self = await getActiveStaffSelf()
  if (!self.ok) {
    const status = self.reason === "unauthenticated" ? 401 : self.reason === "unavailable" ? 404 : 403
    return NextResponse.json({ error: "Not available" }, { status })
  }

  const { assignmentId } = await params
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id: assignmentId, staffMemberId: self.staffMember.id },
    include: {
      trainingModule: { select: { quizzes: true } },
      quizAttempts: { select: { status: true } },
    },
  })
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const quiz = assignment.trainingModule.quizzes[0]
  if (!quiz) return NextResponse.json({ error: "This module has no quiz" }, { status: 400 })
  if (assignment.quizAttempts.some((a) => a.status === "Passed")) {
    return NextResponse.json({ error: "Quiz already passed" }, { status: 409 })
  }
  if (assignment.quizAttempts.some((a) => a.status === "PendingReview")) {
    return NextResponse.json(
      { error: "Your last attempt is waiting on trainer review" },
      { status: 409 }
    )
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { answers } = parsed.data

  const questions = z.array(quizQuestionSchema).safeParse(quiz.questions)
  if (!questions.success) {
    return NextResponse.json({ error: "Quiz is misconfigured — tell your manager" }, { status: 500 })
  }

  // Every question must be answered; grading a half-submitted quiz would
  // silently count blanks as wrong.
  for (const q of questions.data) {
    const a = answers[q.id]
    if (a === undefined || (typeof a === "string" && a.trim() === "") || (Array.isArray(a) && a.length === 0)) {
      return NextResponse.json({ error: "Please answer every question" }, { status: 400 })
    }
  }

  const graded = gradeQuizAnswers(questions.data, answers, quiz.passThreshold)

  const attempt = await prisma.trainingQuizAttempt.create({
    data: {
      trainingAssignmentId: assignment.id,
      questionsSnapshot: questions.data,
      passThresholdSnapshot: quiz.passThreshold,
      answers,
      scorePct: graded.scorePct,
      status: graded.status,
      authMethod: "ClerkSession",
      ipAddress: requestIp(req),
      userAgent: req.headers.get("user-agent"),
    },
  })

  const status = await recalcAssignmentStatus(assignment.id)
  return NextResponse.json(
    { attemptId: attempt.id, attemptStatus: graded.status, scorePct: graded.scorePct, status },
    { status: 201 }
  )
}
