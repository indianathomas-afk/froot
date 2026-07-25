import { format } from "date-fns"
import { Award, CheckCircle2, FileDown, PlayCircle } from "lucide-react"
import { z } from "zod"
import { canonicalYouTubeUrl, youTubeVideoId } from "@/lib/messages"
import { quizQuestionSchema } from "@/app/api/hr/training/schemas"
import { Badge } from "@/components/ui/badge"
import { LessonCompleteButton } from "./training-lesson-complete-button"
import { QuizClient, type MyQuizQuestion } from "./training-quiz-client"

// HR-17: THE trainee-facing training renderer, extracted verbatim from
// /my/training/[assignmentId] so the admin preview shows exactly what staff
// see — one renderer, two modes. Execute mode carries the assignment (live
// progress, completion buttons, quiz submission). Preview mode has no
// assignmentId at all, so neither write endpoint is reachable: lessons show
// a disabled complete button, the quiz is unlocked but cannot submit, and
// nothing is recorded.
export type TrainingViewLesson = {
  id: string
  title: string
  info: string | null
  videoUrl: string | null
  resources: { id: string; label: string }[]
}

export type TrainingViewMode =
  | {
      kind: "execute"
      assignmentId: string
      lessonProgress: { trainingLessonId: string; completedAt: Date }[]
      quizAttempts: { status: string; scorePct: number | null }[]
      certifiedAt: Date | null
    }
  | { kind: "preview" }

// Strip correctOptionIds before anything reaches the client — the quiz
// payload must never carry the answer key (rule shared by both modes so the
// preview can't diverge from what a trainee is sent).
export function toClientQuizQuestions(questions: unknown): MyQuizQuestion[] {
  const parsed = z.array(quizQuestionSchema).safeParse(questions)
  if (!parsed.success) return []
  return parsed.data.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
  }))
}

export function TrainingModuleView({
  title,
  description,
  lessons,
  quiz,
  mode,
}: {
  title: string
  description: string | null
  lessons: TrainingViewLesson[]
  quiz: { passThreshold: number; questions: MyQuizQuestion[] } | null
  mode: TrainingViewMode
}) {
  const progressByLesson = new Map(
    mode.kind === "execute" ? mode.lessonProgress.map((p) => [p.trainingLessonId, p]) : []
  )
  const done = lessons.filter((l) => progressByLesson.has(l.id)).length
  const pct = lessons.length > 0 ? Math.round((done / lessons.length) * 100) : 0

  const quizPassed = mode.kind === "execute" && mode.quizAttempts.some((a) => a.status === "Passed")
  const pendingReview =
    mode.kind === "execute" && mode.quizAttempts.some((a) => a.status === "PendingReview")
  const latestAttempt = mode.kind === "execute" ? mode.quizAttempts[0] : undefined

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--color-foreground)]">{title}</h1>
      {description && (
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{description}</p>
      )}
      <div className="flex items-center gap-3 mt-3 mb-6">
        <div className="flex-1 h-2 rounded-full bg-[var(--color-muted)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-primary)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {done}/{lessons.length} lessons
        </span>
      </div>

      {mode.kind === "execute" && mode.certifiedAt && (
        <div className="flex items-center gap-3 border border-[var(--color-success-border,#bfe8c5)] bg-[var(--color-success-bg,#e8f8ea)] rounded-lg p-4 mb-6">
          <Award className="h-5 w-5 shrink-0 text-[var(--color-success,#25ba3b)]" />
          <p className="text-sm text-[var(--color-success-text,#166b23)]">
            Certified {format(mode.certifiedAt, "MMMM d, yyyy")}. Need a copy of your certificate?
            Ask your manager.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {lessons.map((lesson, i) => {
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

              {mode.kind === "preview" ? (
                <button
                  disabled
                  className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-medium opacity-60 cursor-not-allowed"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark lesson complete
                </button>
              ) : progress ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Completed {format(progress.completedAt, "MMM d, yyyy")}
                </p>
              ) : (
                <LessonCompleteButton assignmentId={mode.assignmentId} lessonId={lesson.id} />
              )}
            </div>
          )
        })}
      </div>

      {quiz && quiz.questions.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
            Quiz
          </h2>
          {mode.kind === "preview" ? (
            <QuizClient preview passThreshold={quiz.passThreshold} questions={quiz.questions} />
          ) : quizPassed ? (
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
          ) : done < lessons.length ? (
            <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Finish all lessons to unlock the quiz.
              </p>
            </div>
          ) : (
            <QuizClient
              assignmentId={mode.assignmentId}
              passThreshold={quiz.passThreshold}
              questions={quiz.questions}
            />
          )}
        </div>
      )}
    </>
  )
}
