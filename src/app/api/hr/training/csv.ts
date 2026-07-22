import { z } from "zod"
import type { QuizQuestion } from "./schemas"

// CSV shape shared by the training export route, import route, and the
// client's example file. Training is three-level (module → lessons + quiz
// questions), so unlike the template CSV each row carries a row_type:
//   "lesson"   → lesson_* columns are read
//   "question" → question_* columns are read
// Module-level columns repeat on every row; the first row of a module wins.
// question_options and question_correct are pipe-separated ("41F|50F");
// correct answers are matched to options by text, or true/false for boolean
// questions. RESOURCES (private files) never travel through CSV — the JSON
// export includes their metadata for reference only.

export const TRAINING_CSV_COLUMNS = [
  "module_title",
  "module_subject",
  "module_description",
  "quiz_pass_threshold",
  "row_type",
  "lesson_title",
  "lesson_info",
  "lesson_video_url",
  "lesson_order_index",
  "question_type",
  "question_prompt",
  "question_options",
  "question_correct",
  "question_order_index",
] as const

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

interface ExportModule {
  title: string
  subject: string | null
  description: string | null
  lessons: { title: string; info: string | null; videoUrl: string | null; orderIndex: number }[]
  quizzes: { passThreshold: number; questions: unknown }[]
}

export function buildTrainingCsv(modules: ExportModule[]): string {
  const lines: string[] = [TRAINING_CSV_COLUMNS.join(",")]

  for (const m of modules) {
    const quiz = m.quizzes[0]
    const moduleCells = [m.title, m.subject, m.description, quiz?.passThreshold ?? ""]
    const blankLesson = ["", "", "", ""]
    const blankQuestion = ["", "", "", "", ""]

    // Modules with no lessons and no quiz still emit one row so they
    // survive the round-trip.
    if (!m.lessons.length && !quiz) {
      lines.push([...moduleCells, "", ...blankLesson, ...blankQuestion].map(csvCell).join(","))
      continue
    }

    for (const l of m.lessons) {
      lines.push(
        [...moduleCells, "lesson", l.title, l.info, l.videoUrl, l.orderIndex, ...blankQuestion]
          .map(csvCell)
          .join(",")
      )
    }

    const questions = (quiz?.questions ?? []) as QuizQuestion[]
    questions.forEach((q, qi) => {
      const options = (q.options ?? []).map((o) => o.text).join("|")
      const correct =
        q.type === "boolean"
          ? (q.correctOptionIds?.[0] ?? "")
          : (q.correctOptionIds ?? [])
              .map((cid) => q.options?.find((o) => o.id === cid)?.text ?? "")
              .filter(Boolean)
              .join("|")
      lines.push(
        [...moduleCells, "question", ...blankLesson, q.type, q.prompt, options, correct, qi]
          .map(csvCell)
          .join(",")
      )
    })
  }

  return "﻿" + lines.join("\r\n")
}

// ── Import side ──────────────────────────────────────────────────────────────

const numish = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  return v
}, z.number().optional())

export const TrainingRowSchema = z.object({
  module_title: z.string().min(1, "module_title is required"),
  module_subject: z.string().optional().nullable(),
  module_description: z.string().optional().nullable(),
  quiz_pass_threshold: numish,
  row_type: z.string().optional().nullable(),
  lesson_title: z.string().optional().nullable(),
  lesson_info: z.string().optional().nullable(),
  lesson_video_url: z.string().optional().nullable(),
  lesson_order_index: numish,
  question_type: z.string().optional().nullable(),
  question_prompt: z.string().optional().nullable(),
  question_options: z.string().optional().nullable(),
  question_correct: z.string().optional().nullable(),
  question_order_index: numish,
})

export type TrainingRow = z.infer<typeof TrainingRowSchema>

export interface GroupedModule {
  title: string
  subject: string | null
  description: string | null
  passThreshold: number
  lessons: { title: string; info: string | null; videoUrl: string | null; orderIndex: number }[]
  questions: QuizQuestion[]
}

// Group validated rows into modules. Row numbers in errors are 1-based over
// the data rows, matching the template import's convention. When row_type is
// blank it is inferred: a question_prompt makes a question row, otherwise a
// lesson_title makes a lesson row.
export function groupTrainingRows(rows: TrainingRow[]): {
  modules: GroupedModule[]
  errors: { row: number; error: string }[]
} {
  const errors: { row: number; error: string }[] = []
  const byTitle = new Map<string, { head: TrainingRow; lessons: { row: TrainingRow; n: number }[]; questions: { row: TrainingRow; n: number }[] }>()

  rows.forEach((r, i) => {
    const n = i + 1
    const key = r.module_title.trim()
    if (!byTitle.has(key)) byTitle.set(key, { head: r, lessons: [], questions: [] })
    const group = byTitle.get(key)!

    const type = r.row_type?.trim().toLowerCase() || (r.question_prompt?.trim() ? "question" : r.lesson_title?.trim() ? "lesson" : "")
    if (type === "lesson") {
      if (!r.lesson_title?.trim()) errors.push({ row: n, error: "lesson row needs lesson_title" })
      else group.lessons.push({ row: r, n })
    } else if (type === "question") {
      if (!r.question_prompt?.trim()) errors.push({ row: n, error: "question row needs question_prompt" })
      else group.questions.push({ row: r, n })
    } else if (r.lesson_title?.trim() || r.question_prompt?.trim()) {
      errors.push({ row: n, error: `row_type must be "lesson" or "question"` })
    }
    // A row with neither lesson nor question content is a bare module row — fine.
  })

  const modules: GroupedModule[] = []
  for (const [title, group] of byTitle) {
    const head = group.head
    const rawThreshold = head.quiz_pass_threshold ?? 80
    const passThreshold = Math.min(100, Math.max(0, Math.round(rawThreshold)))

    const lessons = group.lessons
      .sort((a, b) => (a.row.lesson_order_index ?? a.n) - (b.row.lesson_order_index ?? b.n))
      .map((l, idx) => ({
        title: l.row.lesson_title!.trim(),
        info: l.row.lesson_info?.trim() || null,
        videoUrl: l.row.lesson_video_url?.trim() || null,
        orderIndex: idx,
      }))

    const questions: QuizQuestion[] = []
    const sortedQuestions = group.questions.sort(
      (a, b) => (a.row.question_order_index ?? a.n) - (b.row.question_order_index ?? b.n)
    )
    let ok = true
    sortedQuestions.forEach((qr, qi) => {
      const q = parseQuestionRow(qr.row, qi)
      if ("error" in q) {
        errors.push({ row: qr.n, error: q.error })
        ok = false
      } else {
        questions.push(q.question)
      }
    })
    // A module with a broken question still imports its lessons; the quiz is
    // dropped so nothing half-authored is saved.
    modules.push({
      title,
      subject: head.module_subject?.trim() || null,
      description: head.module_description?.trim() || null,
      passThreshold,
      lessons,
      questions: ok ? questions : [],
    })
  }

  return { modules, errors }
}

const BOOL_TRUE = ["true", "t", "yes", "y", "1"]
const BOOL_FALSE = ["false", "f", "no", "n", "0"]

function parseQuestionRow(
  r: TrainingRow,
  index: number
): { question: QuizQuestion } | { error: string } {
  const prompt = r.question_prompt!.trim()
  const type = (r.question_type?.trim().toLowerCase() || "") as QuizQuestion["type"] | ""
  const id = `q${index + 1}`

  if (type === "written") return { question: { id, type, prompt } }

  if (type === "boolean") {
    const raw = r.question_correct?.trim().toLowerCase() ?? ""
    if (BOOL_TRUE.includes(raw)) return { question: { id, type, prompt, correctOptionIds: ["true"] } }
    if (BOOL_FALSE.includes(raw)) return { question: { id, type, prompt, correctOptionIds: ["false"] } }
    return { error: `question_correct must be true or false for a boolean question` }
  }

  if (type === "single" || type === "multi") {
    const optionTexts = (r.question_options ?? "").split("|").map((s) => s.trim()).filter(Boolean)
    if (optionTexts.length < 2) return { error: "single/multi questions need at least 2 pipe-separated question_options" }
    const options = optionTexts.map((text, oi) => ({ id: `o${oi + 1}`, text }))
    const correctTexts = (r.question_correct ?? "").split("|").map((s) => s.trim()).filter(Boolean)
    if (!correctTexts.length) return { error: "question_correct is required (pipe-separated option text)" }
    const correctOptionIds: string[] = []
    for (const ct of correctTexts) {
      const match = options.find((o) => o.text.toLowerCase() === ct.toLowerCase())
      if (!match) return { error: `correct answer "${ct}" does not match any option` }
      correctOptionIds.push(match.id)
    }
    if (type === "single" && correctOptionIds.length > 1) {
      return { error: "single-choice questions can only have one correct answer" }
    }
    return { question: { id, type, prompt, options, correctOptionIds } }
  }

  return { error: `question_type must be boolean, single, multi, or written (got "${r.question_type ?? ""}")` }
}
