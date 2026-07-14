import { prisma } from "@/lib/prisma"

// HR-7 training execution helpers, shared by the manager-side routes
// (/staff/[id] Training tab, attested completion) and the /my/training
// self-service routes.

// Module completion = every lesson completed + quiz passed (vacuously true
// when the module has no quiz). hoursLogged and certification are tracked on
// top of Completed, they don't gate it.
export async function recalcAssignmentStatus(trainingAssignmentId: string): Promise<string> {
  const assignment = await prisma.trainingAssignment.findUnique({
    where: { id: trainingAssignmentId },
    include: {
      trainingModule: { select: { lessons: { select: { id: true } }, quizzes: { select: { id: true } } } },
      lessonProgress: { select: { trainingLessonId: true } },
      quizAttempts: { select: { status: true } },
    },
  })
  if (!assignment) return "NotStarted"

  const lessonIds = new Set(assignment.trainingModule.lessons.map((l) => l.id))
  const completedIds = new Set(
    assignment.lessonProgress.map((p) => p.trainingLessonId).filter((id) => lessonIds.has(id))
  )
  const allLessonsDone = lessonIds.size > 0 && completedIds.size >= lessonIds.size
  const hasQuiz = assignment.trainingModule.quizzes.length > 0
  const quizPassed = !hasQuiz || assignment.quizAttempts.some((a) => a.status === "Passed")

  const anyProgress = assignment.lessonProgress.length > 0 || assignment.quizAttempts.length > 0
  const status = allLessonsDone && quizPassed ? "Completed" : anyProgress ? "InProgress" : "NotStarted"

  if (status !== assignment.status) {
    await prisma.trainingAssignment.update({ where: { id: trainingAssignmentId }, data: { status } })
  }
  return status
}

// ── Quiz grading (HR-7) ──────────────────────────────────────────────────────
// Objective questions (boolean/single/multi) grade against correctOptionIds;
// written questions are never auto-scored — any written question puts the
// attempt in PendingReview for the trainer (commit-4 review), UNLESS the
// objective misses already make the threshold unreachable even with every
// written answer counted correct: then it's an immediate Failed.

export type QuizAnswerValue = string | string[]

type GradableQuestion = {
  id: string
  type: "boolean" | "single" | "multi" | "written"
  correctOptionIds?: string[]
}

export function gradeQuizAnswers(
  questions: GradableQuestion[],
  answers: Record<string, QuizAnswerValue>,
  passThreshold: number
): { scorePct: number | null; status: "Passed" | "Failed" | "PendingReview" } {
  const total = questions.length
  if (total === 0) return { scorePct: 100, status: "Passed" }

  let objectiveCorrect = 0
  let writtenCount = 0
  for (const q of questions) {
    const answer = answers[q.id]
    if (q.type === "written") {
      writtenCount++
      continue
    }
    const correct = new Set(q.correctOptionIds ?? [])
    if (q.type === "multi") {
      const given = new Set(Array.isArray(answer) ? answer : answer ? [answer] : [])
      if (given.size === correct.size && [...given].every((id) => correct.has(id))) objectiveCorrect++
    } else {
      // boolean / single: exactly one correct option id
      const given = Array.isArray(answer) ? answer[0] : answer
      if (given !== undefined && correct.has(given)) objectiveCorrect++
    }
  }

  const pct = (n: number) => Math.round((n / total) * 100)
  if (writtenCount === 0) {
    const scorePct = pct(objectiveCorrect)
    return { scorePct, status: scorePct >= passThreshold ? "Passed" : "Failed" }
  }
  const bestPossible = pct(objectiveCorrect + writtenCount)
  if (bestPossible < passThreshold) {
    return { scorePct: pct(objectiveCorrect), status: "Failed" }
  }
  return { scorePct: null, status: "PendingReview" }
}

// The audit trail records the connecting client (HR-4 pattern). On Vercel
// x-forwarded-for is set by the platform; first hop is the client.
export function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}
