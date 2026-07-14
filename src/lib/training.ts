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

// The audit trail records the connecting client (HR-4 pattern). On Vercel
// x-forwarded-for is set by the platform; first hop is the client.
export function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  )
}
