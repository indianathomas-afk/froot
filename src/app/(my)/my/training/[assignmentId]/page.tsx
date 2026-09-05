import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { displayTimeZone } from "@/lib/hr"
import { selfFilesServed } from "@/lib/training"
import {
  TrainingModuleView,
  toClientQuizQuestions,
  toLinkedDocument,
} from "@/components/hr/training-module-view"
import { MyShell } from "../../my-shell"
import { MyDenied } from "../../denied"

// /my/training/[assignmentId] — one of the staff member's own modules:
// lesson content (info, video, private resources via the authorized route),
// completion, and the quiz. Rule 3: the assignment resolves against the
// session's staff profile — foreign ids 404. Rule 5: certification shows as
// STATUS only; the cert PDF is never downloadable here. Rendering lives in
// TrainingModuleView (shared with the HR-17 admin preview).
//
// HR-25 (R-m option iii): the page itself does NOT close after completion —
// the module stays readable for refreshers, badge and all. Only the attached
// files stop, and the route refuses them independently of this render.
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
            include: {
              resources: { orderBy: { orderIndex: "asc" } },
              // HR-32: joined UNCONDITIONALLY here, and that is the ruling, not
              // an oversight. Gary, 2026-09-05: STORE suppression is scoped to
              // browsing the library, not to a person's own assigned training —
              // a trainee working the module assigned to them sees the linked
              // document whatever their login's role is. This page is
              // role-blind by design (getActiveStaffSelf resolves a StaffMember,
              // never a role), and a role test here would remove the Day 1 I-9
              // from the one surface this row exists to serve.
              linkedHrDocument: { select: { title: true, externalUrl: true, isActive: true } },
            },
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
        lessons={mod.lessons.map((l) => ({ ...l, linkedDocument: toLinkedDocument(l) }))}
        timeZone={displayTimeZone(self.staffMember, self.org)}
        quiz={quiz ? { passThreshold: quiz.passThreshold, questions: quizQuestions } : null}
        resourcesAvailable={selfFilesServed(assignment)}
        // HR-32. Files stop when the module is complete (HR-25); the linked
        // document does not. It is an external URL with no Froot-side grant to
        // withdraw, and a refresher that has lost its I-9 link is a refresher
        // missing the thing it pointed at.
        linkedDocumentsAvailable
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
