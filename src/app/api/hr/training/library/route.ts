import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { STORE_LIBRARY_WHERE, canReadTrainingModule } from "@/lib/training"
import { requireHrTrainingReadAccess } from "../access"

// GET /api/hr/training/library — HR-24. The READ-ONLY module list, for the
// training surface a STORE login reaches from /hr. ADMIN may call it too (the
// guard admits both), but the builder page keeps using GET /api/hr/training,
// which returns the full authoring payload Duplicate needs.
//
// A NEW ROUTE RATHER THAN A WIDENED GUARD ON GET /api/hr/training, AND THE
// REASON IS THE PAYLOAD, NOT THE GATE. That route includes `quizzes: true` and
// `lessons.resources` verbatim — so its response carries `correctOptionIds`,
// the QUIZ ANSWER KEY, and every resource's raw private blob `fileUrl`. Both
// are safe there because its only caller is the ADMIN builder; neither is safe
// on a shared store iPad. `toClientQuizQuestions` strips the answer key on the
// render paths (training-module-view.tsx:36) and this route never carries it in
// the first place: what is not selected cannot leak. Every field below is one
// the list actually draws.
//
// COUNTS, NOT CONTENT: lessonCount / quizQuestionCount / storeCount are computed
// here so no lesson body, resource row or question text crosses the wire for a
// list view that only ever renders "2 lessons · quiz (5 questions, pass 71%)".
export async function GET() {
  const access = await requireHrTrainingReadAccess()
  if (!access.ok) return access.response
  const { org, role } = access

  // R-h (i), ORG-WIDE: no store-applicability filter. The only narrowing is
  // lifecycle, and it is the policy function's rule expressed as a query —
  // ADMIN sees drafts and archives, STORE sees the live library.
  const modules = await prisma.trainingModule.findMany({
    where: {
      organizationId: org.id,
      ...(role === "ADMIN" ? {} : STORE_LIBRARY_WHERE),
    },
    select: {
      id: true,
      title: true,
      subject: true,
      description: true,
      appliesTo: true,
      isActive: true,
      isArchived: true,
      organizationId: true,
      category: { select: { id: true, name: true, colorKey: true } },
      quizzes: { select: { passThreshold: true, questions: true } },
      _count: { select: { lessons: true, storeAssignments: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  // Belt and braces, and the reason the function exists rather than only the
  // fragment: the query above and canReadTrainingModule are two expressions of
  // one rule, so the list is re-filtered through the function. If they ever
  // disagree, the function wins and the stricter answer is the one that ships.
  const readable = modules.filter((m) =>
    canReadTrainingModule(m, { orgDbId: org.id, role })
  )

  return NextResponse.json(
    readable.map((m) => {
      const quiz = m.quizzes[0]
      return {
        id: m.id,
        title: m.title,
        subject: m.subject,
        description: m.description,
        categoryId: m.category?.id ?? null,
        category: m.category,
        appliesTo: m.appliesTo,
        isActive: m.isActive,
        isArchived: m.isArchived,
        lessonCount: m._count.lessons,
        storeCount: m._count.storeAssignments,
        // Length only. The questions themselves never leave this function.
        quizQuestionCount: Array.isArray(quiz?.questions) ? quiz.questions.length : 0,
        quizPassThreshold: quiz?.passThreshold ?? null,
      }
    })
  )
}
