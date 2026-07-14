import Link from "next/link"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { ArrowLeft, Award, CheckCircle2, FileDown, PlayCircle } from "lucide-react"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { canonicalYouTubeUrl, youTubeVideoId } from "@/lib/messages"
import { quizQuestionSchema } from "@/app/api/hr/training/schemas"
import { Badge } from "@/components/ui/badge"
import { MyShell } from "../../my-shell"
import { MyDenied } from "../../denied"
import { LessonCompleteButton } from "./lesson-actions"
import { QuizClient, type MyQuizQuestion } from "./quiz-client"

// /my/training/[assignmentId] — one of the staff member's own modules:
// lesson content (info, video, private resources via the authorized route),
// completion, and the quiz. Rule 3: the assignment resolves against the
// session's staff profile — foreign ids 404. Rule 5: certification shows as
// STATUS only; the cert PDF is never downloadable here.
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
  const progressByLesson = new Map(assignment.lessonProgress.map((p) => [p.trainingLessonId, p]))
  const done = mod.lessons.filter((l) => progressByLesson.has(l.id)).length
  const pct = mod.lessons.length > 0 ? Math.round((done / mod.lessons.length) * 100) : 0

  const quiz = mod.quizzes[0]
  const quizPassed = assignment.quizAttempts.some((a) => a.status === "Passed")
  const pendingReview = assignment.quizAttempts.some((a) => a.status === "PendingReview")
  const latestAttempt = assignment.quizAttempts[0]

  // Strip correctOptionIds before anything reaches the client — the quiz
  // payload must never carry the answer key.
  let quizQuestions: MyQuizQuestion[] = []
  if (quiz) {
    const parsed = z.array(quizQuestionSchema).safeParse(quiz.questions)
    if (parsed.success) {
      quizQuestions = parsed.data.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
      }))
    }
  }

  return (
    <MyShell>
      <Link
        href="/my/training"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] mb-3 min-h-11"
      >
        <ArrowLeft className="h-4 w-4" />
        My Training
      </Link>

      <h1 className="text-xl font-bold text-[var(--color-foreground)]">{mod.title}</h1>
      {mod.description && (
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{mod.description}</p>
      )}
      <div className="flex items-center gap-3 mt-3 mb-6">
        <div className="flex-1 h-2 rounded-full bg-[var(--color-muted)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-primary)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {done}/{mod.lessons.length} lessons
        </span>
      </div>

      {assignment.certifiedAt && (
        <div className="flex items-center gap-3 border border-[var(--color-success-border,#bfe8c5)] bg-[var(--color-success-bg,#e8f8ea)] rounded-lg p-4 mb-6">
          <Award className="h-5 w-5 shrink-0 text-[var(--color-success,#25ba3b)]" />
          <p className="text-sm text-[var(--color-success-text,#166b23)]">
            Certified {format(assignment.certifiedAt, "MMMM d, yyyy")}. Need a copy of your certificate?
            Ask your manager.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {mod.lessons.map((lesson, i) => {
          const progress = progressByLesson.get(lesson.id)
          const video = lesson.videoUrl ? canonicalYouTubeUrl(lesson.videoUrl) : null
          const videoId = video ? youTubeVideoId(video) : null
          return (
            <div
              key={lesson.id}
              className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                {progress ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success,#25ba3b)]" />
                ) : (
                  <span className="w-5 h-5 shrink-0 rounded-full border-2 border-[var(--color-border)] text-[10px] flex items-center justify-center text-[var(--color-muted-foreground)]">
                    {i + 1}
                  </span>
                )}
                <p className="font-medium text-[var(--color-foreground)]">{lesson.title}</p>
              </div>

              {lesson.info && (
                <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mb-3">
                  {lesson.info}
                </p>
              )}

              {videoId ? (
                <div className="aspect-video mb-3 rounded-md overflow-hidden">
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title={lesson.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full"
                  />
                </div>
              ) : lesson.videoUrl ? (
                <a
                  href={lesson.videoUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] mb-3 min-h-11"
                >
                  <PlayCircle className="h-4 w-4" />
                  Watch video
                </a>
              ) : null}

              {lesson.resources.length > 0 && (
                <div className="space-y-1 mb-3">
                  {lesson.resources.map((r) => (
                    <a
                      key={r.id}
                      href={`/api/hr/training/resources/${r.id}/download`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] min-h-11"
                    >
                      <FileDown className="h-4 w-4 shrink-0" />
                      {r.label}
                    </a>
                  ))}
                </div>
              )}

              {progress ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Completed {format(progress.completedAt, "MMM d, yyyy")}
                </p>
              ) : (
                <LessonCompleteButton assignmentId={assignment.id} lessonId={lesson.id} />
              )}
            </div>
          )
        })}
      </div>

      {quiz && quizQuestions.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
            Quiz
          </h2>
          {quizPassed ? (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-[var(--color-success,#25ba3b)]" />
              <p className="text-sm text-[var(--color-foreground)]">
                Quiz passed
                {latestAttempt?.status === "Passed" && latestAttempt.scorePct !== null
                  ? ` — ${latestAttempt.scorePct}%`
                  : ""}
              </p>
              <Badge variant="success" className="ml-auto">
                Passed
              </Badge>
            </div>
          ) : pendingReview ? (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
              <p className="text-sm text-[var(--color-foreground)] font-medium mb-1">Waiting on review</p>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Your written answers are with a trainer. The result will show here once graded.
              </p>
            </div>
          ) : done < mod.lessons.length ? (
            <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Finish all lessons to unlock the quiz.
              </p>
            </div>
          ) : (
            <QuizClient
              assignmentId={assignment.id}
              passThreshold={quiz.passThreshold}
              questions={quizQuestions}
            />
          )}
        </div>
      )}
    </MyShell>
  )
}
