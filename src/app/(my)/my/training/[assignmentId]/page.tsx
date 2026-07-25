import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import {
  TrainingModuleView,
  toClientQuizQuestions,
} from "@/components/hr/training-module-view"
import { MyShell } from "../../my-shell"
import { MyDenied } from "../../denied"

// /my/training/[assignmentId] — one of the staff member's own modules:
// lesson content (info, video, private resources via the authorized route),
// completion, and the quiz. Rule 3: the assignment resolves against the
// session's staff profile — foreign ids 404. Rule 5: certification shows as
// STATUS only; the cert PDF is never downloadable here. Rendering lives in
// TrainingModuleView (shared with the HR-17 admin preview).
export default async function MyModulePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>
}) {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />

  const { assignmentId } = await params
  const assignment = await prisma.trainingAssignment.findFirst({
    where: { id: assignmentId, staffMemberId: self.staffMember.id },
    include: {
      trainingModule: {
        select: {
          title: true,
          description: true,
          lessons: {
            orderBy: { orderIndex: "asc" },
            include: { resources: { orderBy: { orderIndex: "asc" } } },
          },
          quizzes: true,
        },
      },
      lessonProgress: { select: { trainingLessonId: true, completedAt: true } },
      quizAttempts: { orderBy: { submittedAt: "desc" } },
    },
  })
  if (!assignment) notFound()

  const mod = assignment.trainingModule
  const quiz = mod.quizzes[0]
  const quizQuestions = quiz ? toClientQuizQuestions(quiz.questions) : []

  return (
    <MyShell showInstagram={!!self.org.instagramEnabled && !!self.org.instagramAccessToken}>
      <Link
        href="/my/training"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] mb-3 min-h-11"
      >
        <ArrowLeft className="h-4 w-4" />
        My Training
      </Link>

      <TrainingModuleView
        title={mod.title}
        description={mod.description}
        lessons={mod.lessons}
        quiz={quiz ? { passThreshold: quiz.passThreshold, questions: quizQuestions } : null}
        mode={{
          kind: "execute",
          assignmentId: assignment.id,
          lessonProgress: assignment.lessonProgress,
          quizAttempts: assignment.quizAttempts,
          certifiedAt: assignment.certifiedAt,
        }}
      />
    </MyShell>
  )
}
