import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../access"
import { groupTrainingRows, TrainingRowSchema, type TrainingRow } from "../csv"

// ─── Training Import ──────────────────────────────────────────────────────────
// POST /api/hr/training/import
// Body: { rows: [...], mode?: "append" | "replace" } — the CSV parsed to
// objects (see csv.ts for the column contract). Rows group into modules by
// module_title. Mirrors /api/templates/import: imported modules arrive
// INACTIVE and org-wide (appliesTo="all") so nothing goes live unreviewed;
// replace mode first archives same-named modules. Resource files are never
// imported — attach them in the builder afterwards.
export async function POST(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response
  const { org } = access

  const body = await req.json().catch(() => null)
  const rows: unknown[] = Array.isArray(body) ? body : body?.rows
  const mode: "append" | "replace" = body?.mode === "replace" ? "replace" : "append"
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Expected an array of rows (or { rows: [...] })" }, { status: 400 })
  }

  const validRows: TrainingRow[] = []
  const errors: { row: number; error: string }[] = []
  rows.forEach((raw, i) => {
    const parsed = TrainingRowSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push({ row: i + 1, error: parsed.error.issues.map((e) => e.message).join(", ") })
    } else {
      validRows.push(parsed.data)
    }
  })

  const grouped = groupTrainingRows(validRows)
  errors.push(...grouped.errors)

  let modulesCreated = 0
  let lessonsCreated = 0
  let questionsCreated = 0
  const created: { title: string; lessons: number; questions: number }[] = []

  for (const m of grouped.modules) {
    try {
      await prisma.$transaction(async (tx) => {
        if (mode === "replace") {
          await tx.trainingModule.updateMany({
            where: { organizationId: org.id, title: m.title, isArchived: false },
            data: { isArchived: true, isActive: false },
          })
        }

        await tx.trainingModule.create({
          data: {
            organizationId: org.id,
            title: m.title,
            subject: m.subject,
            description: m.description,
            appliesTo: "all",
            isActive: false, // imported modules arrive inactive; review before going live
            lessons: { create: m.lessons },
            quizzes: m.questions.length
              ? { create: { passThreshold: m.passThreshold, questions: m.questions } }
              : undefined,
          },
        })

        modulesCreated++
        lessonsCreated += m.lessons.length
        questionsCreated += m.questions.length
        created.push({ title: m.title, lessons: m.lessons.length, questions: m.questions.length })
      })
    } catch (err) {
      console.error("Failed to import training module", m.title, err)
      errors.push({ row: 0, error: `Failed to create module "${m.title}"` })
    }
  }

  return NextResponse.json({ modulesCreated, lessonsCreated, questionsCreated, created, errors })
}
