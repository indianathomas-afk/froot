// ── Quiz grading (HR-7) ──────────────────────────────────────────────────────
// Objective questions (boolean/single/multi) grade against correctOptionIds;
// written questions are never auto-scored — any written question puts the
// attempt in PendingReview for the trainer (commit-4 review), UNLESS the
// objective misses already make the threshold unreachable even with every
// written answer counted correct: then it's an immediate Failed.
//
// PURE — no Prisma import. Moved out of training.ts in QREV-1 so the attempt
// breakdown (below) and its fixture can share the grader's per-question rule
// without opening a connection. training.ts re-exports everything here, so
// existing importers are unchanged.

export type QuizAnswerValue = string | string[]

type GradableQuestion = {
  id: string
  type: "boolean" | "single" | "multi" | "written"
  correctOptionIds?: string[]
}

// The per-question rule, shared by countObjectiveCorrect (and so by the
// grader and the trainer review) and by attemptBreakdown. There is exactly one
// definition of "this objective answer is correct"; never add a second.
export function isObjectiveAnswerCorrect(q: GradableQuestion, answer: QuizAnswerValue | undefined): boolean {
  const correct = new Set(q.correctOptionIds ?? [])
  if (q.type === "multi") {
    const given = new Set(Array.isArray(answer) ? answer : answer ? [answer] : [])
    return given.size === correct.size && [...given].every((id) => correct.has(id))
  }
  // boolean / single: exactly one correct option id
  const given = Array.isArray(answer) ? answer[0] : answer
  return given !== undefined && correct.has(given)
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
    if (q.type === "written") {
      writtenQuestionIds.push(q.id)
      continue
    }
    if (isObjectiveAnswerCorrect(q, answers[q.id])) objectiveCorrect++
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

// ── Attempt review (QREV-1) ──────────────────────────────────────────────────
// What a manager sees when they open "Review answers" on a past attempt.
//
// SNAPSHOT, NOT LIVE QUIZ. The caller passes the attempt's questionsSnapshot —
// the quiz exactly as graded. A quiz edited after the attempt must not change
// what the review shows, so nothing here ever reads the live quiz.
//
// THE STORED SCORE IS THE RECORD. The breakdown re-derives the objective half
// via the grader's own per-question rule; breakdownMatchesScore says whether
// that is consistent with the attempt's stored scorePct. A mismatch is shown
// as a muted caveat — the stored score is never overwritten or "corrected".
//
// Labels only: option ids are resolved to their text here, so the page ships
// strings, never the raw snapshot JSON.

export type AttemptBreakdownResult = "correct" | "incorrect" | "written" | "unanswered"

export type AttemptBreakdownItem = {
  prompt: string
  type: "boolean" | "single" | "multi" | "written"
  answer: string[] // their answer as labels (written: the text, one entry)
  correctAnswer: string[] // correct answer as labels; empty for written
  result: AttemptBreakdownResult
}

export type AttemptBreakdown = {
  items: AttemptBreakdownItem[]
  total: number
  objectiveCorrect: number
  writtenCount: number
}

type SnapshotQuestion = {
  id?: unknown
  type?: unknown
  prompt?: unknown
  options?: unknown
  correctOptionIds?: unknown
}

const QUESTION_TYPES = new Set(["boolean", "single", "multi", "written"])
const BOOLEAN_LABELS: Record<string, string> = { true: "True", false: "False" }

function isBlank(answer: QuizAnswerValue | undefined): boolean {
  return (
    answer === undefined ||
    (typeof answer === "string" && answer.trim() === "") ||
    (Array.isArray(answer) && answer.length === 0)
  )
}

// Returns null when the snapshot is unreadable (not an array, or a question
// without an id/known type) — the caller then ships no breakdown rather than a
// partial one that would silently disagree with the grader.
export function attemptBreakdown(questionsSnapshot: unknown, answers: unknown): AttemptBreakdown | null {
  if (!Array.isArray(questionsSnapshot)) return null
  const given = (answers && typeof answers === "object" ? answers : {}) as Record<string, QuizAnswerValue>

  const items: AttemptBreakdownItem[] = []
  let objectiveCorrect = 0
  let writtenCount = 0
  for (const raw of questionsSnapshot as SnapshotQuestion[]) {
    if (!raw || typeof raw.id !== "string" || typeof raw.type !== "string" || !QUESTION_TYPES.has(raw.type)) {
      return null
    }
    const q: GradableQuestion = {
      id: raw.id,
      type: raw.type as GradableQuestion["type"],
      correctOptionIds: Array.isArray(raw.correctOptionIds)
        ? raw.correctOptionIds.filter((c): c is string => typeof c === "string")
        : undefined,
    }
    const prompt = typeof raw.prompt === "string" ? raw.prompt : ""
    const answer = given[q.id]

    if (q.type === "written") {
      writtenCount++
      const text = typeof answer === "string" ? answer : Array.isArray(answer) ? answer.join(", ") : ""
      items.push({
        prompt,
        type: q.type,
        answer: text.trim() ? [text] : [],
        correctAnswer: [],
        result: text.trim() ? "written" : "unanswered",
      })
      continue
    }

    const labelById = new Map<string, string>()
    if (Array.isArray(raw.options)) {
      for (const o of raw.options as { id?: unknown; text?: unknown }[]) {
        if (o && typeof o.id === "string") labelById.set(o.id, typeof o.text === "string" ? o.text : o.id)
      }
    }
    // An id the snapshot doesn't know (e.g. a tampered or stale payload) is
    // shown as such rather than as its raw id.
    const label = (id: string) =>
      labelById.get(id) ?? (q.type === "boolean" ? BOOLEAN_LABELS[id] : undefined) ?? "(unknown option)"

    const correct = isObjectiveAnswerCorrect(q, answer)
    if (correct) objectiveCorrect++
    const givenIds = Array.isArray(answer) ? answer : typeof answer === "string" && answer ? [answer] : []
    items.push({
      prompt,
      type: q.type,
      answer: givenIds.map(label),
      correctAnswer: (q.correctOptionIds ?? []).map(label),
      result: correct ? "correct" : isBlank(answer) ? "unanswered" : "incorrect",
    })
  }
  return { items, total: items.length, objectiveCorrect, writtenCount }
}

// Is the breakdown consistent with the stored score? Without written questions
// the objective tally IS the score. With them, per-question written marks are
// not stored (only the trainer's final score), so the stored score is
// consistent when SOME count of written answers marked correct (0..writtenCount)
// produces it — the same arithmetic as the grader and the review route.
// A null stored score (PendingReview) has nothing to disagree with.
export function breakdownMatchesScore(b: AttemptBreakdown, storedScorePct: number | null): boolean {
  if (storedScorePct === null) return true
  if (b.total === 0) return storedScorePct === 100
  for (let k = 0; k <= b.writtenCount; k++) {
    if (Math.round(((b.objectiveCorrect + k) / b.total) * 100) === storedScorePct) return true
  }
  return false
}
