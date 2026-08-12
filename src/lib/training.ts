import { prisma } from "@/lib/prisma"

// HR-7 training execution helpers, shared by the manager-side routes
// (/staff/[id] Training tab, attested completion) and the /my/training
// self-service routes.

// ── HR-25: completed training stops serving files ────────────────────────────
// R-m option (iii), ruled by Gary 2026-08-11 — CONTENT STAYS, FILES STOP. Once
// a staff member's own assignment is finished they may still READ the module
// (lesson bodies, quiz result, the Completed/Certified badge) but are no longer
// served its attached files.
//
// TWO EXPRESSIONS OF ONE RULE, AND THEY LIVE TOGETHER SO THEY CANNOT DRIFT: the
// Prisma fragment gates the SELF tier of the resource download route; the
// boolean gates whether the renderer draws the links at all. Both must move
// together — a server refusal without the UI half leaves visible links that
// 404, which is the failure the training access audit named (§3.3), and the UI
// half without the server refusal is not a gate.
//
// certifiedAt is in the test as well as status, and it is not redundant.
// Certification requires Completed today, but a module that gains a lesson
// AFTER someone was certified recalculates to InProgress on the next write
// (recalcAssignmentStatus below) while certifiedAt stays set. Belt and braces
// keeps that person on the refused side, which is the direction the ruling
// points.
//
// SCOPED TO THE SELF TIER ONLY. The ADMIN/MANAGER (manage) tier of the download
// route is untouched — a manager reviewing training is unaffected.
export const SELF_FILES_SERVED_WHERE = { status: { not: "Completed" }, certifiedAt: null }

export function selfFilesServed(assignment: { status: string; certifiedAt: Date | null }): boolean {
  return assignment.status !== "Completed" && assignment.certifiedAt === null
}

// ── HR-24: who may READ a training module ────────────────────────────────────
// The canReadHrDocument analogue (hr-files.ts:243) and the reason this session
// has a policy FUNCTION rather than a role test copied into three files: when
// the input to this rule changes, it changes here, once, with a name.
//
// R-j, ruled by Gary 2026-08-11 — OPTION (i), NO CLASSIFICATION. The library is
// one bucket: there is no confidential/operational distinction, so nothing about
// a module's CONTENT is consulted here. TrainingCategory (HR-20) stays a label
// and is deliberately NOT an input — promoting it would have made a cosmetic
// field a permission input while 12 of 12 Keva production modules are
// uncategorized (HR-20's row), which is wrong on day one in both directions.
//
// R-h, ruled the same day — OPTION (i), ORG-WIDE. STORE sees every module in
// its org, not only those applying to its store. Measured on preview/staging
// (br-square-feather-a63z92vz, org cmr54z65v000105jxczpt72w1): all 5 modules are
// appliesTo "all", so the store filter would have filtered NOTHING while
// permanently promoting appliesTo from an ASSIGNABILITY filter to a VISIBILITY
// one — a one-way semantic change bought for a measured zero effect. If store
// scoping is wanted later it is the OR clause at preview/page.tsx and belongs
// on its own row, with evidence.
//
// WHAT IS LEFT, THEN, IS LIFECYCLE, and it is the whole rule: ADMIN owns the
// builder and must reach drafts and archives; a reader reads the live library
// and has no business with either. TWO EXPRESSIONS OF ONE RULE KEPT ADJACENT,
// the HR-25 pattern directly above — the fragment narrows the list query, the
// function is asked per module (the list re-filters through it, and the read
// surface asks it before rendering).
//
// ── HR-26: MANAGER JOINS THE READ TIER, STORE-SCOPED ─────────────────────────
// Gary, 2026-08-12. MANAGER reads the same library and additionally assigns from
// it. The rule gains ONE input — the manager's stores — and it is added HERE
// rather than as a role test in the pages, which is the whole reason this
// function exists.
//
// MANAGER IS NARROWER THAN STORE, DELIBERATELY, AND R-h(i) IS NOT BEING
// REVERSED. R-h's org-wide ruling rests on appliesTo never having been a
// visibility filter — true for STORE, and false for MANAGER, which HR-17 has
// narrowed by exactly this OR clause since 2026-07-25 (preview/page.tsx) as has
// the manage tier of the resource download route. Giving MANAGER an org-wide
// library would WIDEN manager read reach beyond what HR-17 settled; store
// scoping preserves it. It also buys the chain LIST ⊆ PREVIEW ⊆ DOWNLOAD: no
// row can appear whose Read 404s, and no file link can appear that the download
// route refuses — which is what lets HR-26 answer resourcesAvailable true for
// MANAGER without touching a guard.
//
// STAFF is still absent on purpose: staff read through /my/training under their
// own assignment-scoped policy. This tier is the library, not an assignment.
export const STORE_LIBRARY_WHERE = { isActive: true, isArchived: false }

// The query-shaped twin of the MANAGER branch below, the same way
// STORE_LIBRARY_WHERE is the twin of the STORE branch. Lifecycle AND
// applicability — a manager reads the live library for their own stores.
export function managerLibraryWhere(storeIds: string[]) {
  return {
    ...STORE_LIBRARY_WHERE,
    OR: [
      { appliesTo: "all" },
      { storeAssignments: { some: { storeId: { in: storeIds } } } },
    ],
  }
}

// storeAssignments and appliesTo are REQUIRED on the input rather than optional:
// a caller that cannot supply them cannot ask this question about a MANAGER, and
// an optional field would silently answer "not applicable" for a module whose
// assignments simply were not selected.
export type ReadableTrainingModule = {
  organizationId: string
  isActive: boolean
  isArchived: boolean
  appliesTo: string
  storeAssignments: { storeId: string }[]
}

export type TrainingModuleReader = {
  orgDbId: string
  role: string | null
  storeIds: string[]
}

export function canReadTrainingModule(
  trainingModule: ReadableTrainingModule,
  viewer: TrainingModuleReader
): boolean {
  if (trainingModule.organizationId !== viewer.orgDbId) return false
  // The builder owns drafts and archives; every other reader gets the live
  // library and nothing else.
  if (viewer.role === "ADMIN") return true
  if (!trainingModule.isActive || trainingModule.isArchived) return false
  if (viewer.role === "STORE") return true
  if (viewer.role === "MANAGER") {
    return (
      trainingModule.appliesTo === "all" ||
      trainingModule.storeAssignments.some((a) => viewer.storeIds.includes(a.storeId))
    )
  }
  return false
}

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

// Objective tally shared by auto-grading (below) and the trainer's
// written-answer review (which re-derives the objective half from the
// attempt's snapshot before adding the written marks).
export function countObjectiveCorrect(
  questions: GradableQuestion[],
  answers: Record<string, QuizAnswerValue>
): { objectiveCorrect: number; writtenQuestionIds: string[] } {
  let objectiveCorrect = 0
  const writtenQuestionIds: string[] = []
  for (const q of questions) {
    const answer = answers[q.id]
    if (q.type === "written") {
      writtenQuestionIds.push(q.id)
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
  return { objectiveCorrect, writtenQuestionIds }
}

export function gradeQuizAnswers(
  questions: GradableQuestion[],
  answers: Record<string, QuizAnswerValue>,
  passThreshold: number
): { scorePct: number | null; status: "Passed" | "Failed" | "PendingReview" } {
  const total = questions.length
  if (total === 0) return { scorePct: 100, status: "Passed" }

  const { objectiveCorrect, writtenQuestionIds } = countObjectiveCorrect(questions, answers)
  const writtenCount = writtenQuestionIds.length

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
