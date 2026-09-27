/**
 * QREV-1 — quiz attempt review breakdown, pinned.
 *
 *   npx tsx scripts/verify-quiz-review.ts
 *
 * PURE: imports only src/lib/training-quiz.ts (no Prisma) and opens no
 * connection. What it checks is arithmetic over a snapshot + answers, which a
 * database fixture could only prove on whatever rows dev happens to hold.
 *
 * WHAT THIS CAN DETECT:
 *   - A SECOND GRADING RULE. Every case asserts the breakdown's objective tally
 *     equals countObjectiveCorrect's, and (no written questions) that its
 *     recomputed score equals gradeQuizAnswers' score. If someone re-implements
 *     "is this answer right" inside attemptBreakdown and the two drift, a case
 *     fails.
 *   - THE LIVE QUIZ LEAKING IN. Case "edited" grades the same answers against
 *     the snapshot and against an edited "live" quiz; the breakdown must follow
 *     the snapshot it was handed.
 *   - IDS SHIPPING INSTEAD OF LABELS. Answers and correct answers are asserted
 *     as option text, and an id the snapshot doesn't know renders as
 *     "(unknown option)", never as the raw id.
 *   - THE SCORE-CONSISTENCY CHECK GOING SOFT. A deliberately wrong stored score
 *     must be reported as a mismatch.
 */
import {
  attemptBreakdown,
  breakdownMatchesScore,
  countObjectiveCorrect,
  gradeQuizAnswers,
  type QuizAnswerValue,
} from "../src/lib/training-quiz"

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passes++
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type Q = {
  id: string
  type: "boolean" | "single" | "multi" | "written"
  prompt: string
  options?: { id: string; text: string }[]
  correctOptionIds?: string[]
}

const colors = [
  { id: "o1", text: "Red" },
  { id: "o2", text: "Green" },
  { id: "o3", text: "Blue" },
]
const single: Q = { id: "q1", type: "single", prompt: "Pick green", options: colors, correctOptionIds: ["o2"] }
const multi: Q = { id: "q2", type: "multi", prompt: "Pick red and blue", options: colors, correctOptionIds: ["o1", "o3"] }
const bool: Q = { id: "q3", type: "boolean", prompt: "Sky is blue", correctOptionIds: ["true"] }
const written: Q = { id: "q4", type: "written", prompt: "Explain FIFO" }

// Every case: the breakdown must agree with the grader it claims to reuse.
function agreesWithGrader(label: string, questions: Q[], answers: Record<string, QuizAnswerValue>) {
  const b = attemptBreakdown(questions, answers)
  check(`${label}: breakdown readable`, b !== null)
  if (!b) return null
  const { objectiveCorrect, writtenQuestionIds } = countObjectiveCorrect(questions, answers)
  check(`${label}: objective tally = grader's`, b.objectiveCorrect === objectiveCorrect, `${b.objectiveCorrect} vs ${objectiveCorrect}`)
  check(`${label}: written count = grader's`, b.writtenCount === writtenQuestionIds.length)
  const graded = gradeQuizAnswers(questions, answers, 80)
  if (b.writtenCount === 0) {
    const recomputed = b.total === 0 ? 100 : Math.round((b.objectiveCorrect / b.total) * 100)
    check(`${label}: recomputed score = grader score (${graded.scorePct})`, recomputed === graded.scorePct)
  }
  check(`${label}: consistent with grader's stored score`, breakdownMatchesScore(b, graded.scorePct))
  return b
}

console.log("single choice")
{
  const right = agreesWithGrader("single right", [single], { q1: "o2" })
  check("single right: result correct", right?.items[0].result === "correct")
  check("single right: labels", eq(right?.items[0].answer, ["Green"]) && eq(right?.items[0].correctAnswer, ["Green"]))
  const wrong = agreesWithGrader("single wrong", [single], { q1: "o1" })
  check("single wrong: result incorrect", wrong?.items[0].result === "incorrect")
  check("single wrong: their answer Red, correct Green", eq(wrong?.items[0].answer, ["Red"]) && eq(wrong?.items[0].correctAnswer, ["Green"]))
}

console.log("multi select")
{
  const exact = agreesWithGrader("multi exact", [multi], { q2: ["o3", "o1"] })
  check("multi exact: correct", exact?.items[0].result === "correct")
  const partial = agreesWithGrader("multi partial", [multi], { q2: ["o1"] })
  check("multi partial: incorrect", partial?.items[0].result === "incorrect")
  check("multi partial: correct answer lists both", eq(partial?.items[0].correctAnswer, ["Red", "Blue"]))
  const extra = agreesWithGrader("multi extra", [multi], { q2: ["o1", "o2", "o3"] })
  check("multi extra: incorrect", extra?.items[0].result === "incorrect")
  check("multi extra: shows all three selected labels", eq(extra?.items[0].answer, ["Red", "Green", "Blue"]))
}

console.log("boolean")
{
  const f = agreesWithGrader("boolean wrong", [bool], { q3: "false" })
  check("boolean wrong: False vs True labels", eq(f?.items[0].answer, ["False"]) && eq(f?.items[0].correctAnswer, ["True"]))
}

console.log("written")
{
  const w = agreesWithGrader("written answered", [single, written], { q1: "o2", q4: "First in, first out" })
  check("written: result written", w?.items[1].result === "written")
  check("written: answer text shipped, no correct answer", eq(w?.items[1].answer, ["First in, first out"]) && w?.items[1].correctAnswer.length === 0)
  // Trainer later graded: 1 objective + written marked correct = 100; marked wrong = 50. Both consistent.
  check("written: stored 100 (written marked right) consistent", !!w && breakdownMatchesScore(w, 100))
  check("written: stored 50 (written marked wrong) consistent", !!w && breakdownMatchesScore(w, 50))
  check("written: stored 0 is a mismatch", !!w && !breakdownMatchesScore(w, 0))
  const blank = agreesWithGrader("written blank", [written], { q4: "   " })
  check("written blank: unanswered", blank?.items[0].result === "unanswered")
}

console.log("unanswered")
{
  const u = agreesWithGrader("unanswered", [single, multi], { q1: "o2" })
  check("unanswered: multi with no answer is unanswered", u?.items[1].result === "unanswered" && u?.items[1].answer.length === 0)
  const emptyArr = agreesWithGrader("empty array", [multi], { q2: [] })
  check("empty array: unanswered", emptyArr?.items[0].result === "unanswered")
}

console.log("answer id not in snapshot")
{
  const x = agreesWithGrader("unknown id", [single], { q1: "o-deleted" })
  check("unknown id: incorrect", x?.items[0].result === "incorrect")
  check("unknown id: rendered as (unknown option), not the raw id", eq(x?.items[0].answer, ["(unknown option)"]))
}

console.log("quiz edited after the attempt")
{
  const answers = { q1: "o2" }
  // Live quiz since edited: correct answer moved to Blue, Green renamed.
  const live: Q = {
    ...single,
    options: [colors[0], { id: "o2", text: "Lime" }, colors[2]],
    correctOptionIds: ["o3"],
  }
  const fromSnapshot = agreesWithGrader("snapshot", [single], answers)
  const fromLive = attemptBreakdown([live], answers)
  check("edited: snapshot says correct", fromSnapshot?.items[0].result === "correct")
  check("edited: snapshot labels are the as-graded ones", eq(fromSnapshot?.items[0].answer, ["Green"]))
  check("edited: the live quiz would disagree (proves the input matters)", fromLive?.items[0].result === "incorrect")
}

console.log("stored-score mismatch")
{
  const b = attemptBreakdown([single, bool], { q1: "o2", q3: "false" })!
  check("mismatch: 50 matches", breakdownMatchesScore(b, 50))
  check("mismatch: 38 is reported", !breakdownMatchesScore(b, 38))
  check("mismatch: null (PendingReview) never mismatches", breakdownMatchesScore(b, null))
}

console.log("unreadable snapshot")
{
  check("non-array snapshot → null", attemptBreakdown({}, {}) === null)
  check("question without id → null", attemptBreakdown([{ type: "single", prompt: "x" }], {}) === null)
  check("unknown type → null", attemptBreakdown([{ id: "a", type: "essay", prompt: "x" }], {}) === null)
}

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
