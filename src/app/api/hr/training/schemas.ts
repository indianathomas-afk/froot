import { z } from "zod"

// TrainingQuiz.questions JSON shape. HR-6 authors it; HR-7 grades against it.
// "written" questions have no correctOptionIds — they get manual review.
export const quizQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["boolean", "single", "multi", "written"]),
  prompt: z.string().trim().min(1),
  options: z.array(z.object({ id: z.string().min(1), text: z.string() })).optional(),
  correctOptionIds: z.array(z.string()).optional(),
})

// passThreshold is a percent 0–100 (Keva's "10/14" ≈ 71).
export const quizSchema = z.object({
  passThreshold: z.number().int().min(0).max(100),
  questions: z.array(quizQuestionSchema),
})

export type QuizQuestion = z.infer<typeof quizQuestionSchema>
