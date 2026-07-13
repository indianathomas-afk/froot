import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../access"
import { quizSchema } from "../schemas"

const lessonSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1),
  info: z.string().nullish(),
  videoUrl: z.string().nullish(),
  orderIndex: z.number().int().min(0).default(0),
})

const updateSchema = z.object({
  title: z.string().trim().min(1),
  subject: z.string().nullish(),
  description: z.string().nullish(),
  appliesTo: z.enum(["all", "selected"]).default("all"),
  storeIds: z.array(z.string()).default([]),
  isActive: z.boolean().optional(),
  lessons: z.array(lessonSchema).default([]),
  quiz: quizSchema.nullish(),
})

const moduleInclude = {
  lessons: {
    orderBy: { orderIndex: "asc" as const },
    include: { resources: { orderBy: { orderIndex: "asc" as const } } },
  },
  quizzes: true,
  storeAssignments: true,
}

async function findOrgModule(id: string, organizationId: string) {
  return prisma.trainingModule.findFirst({ where: { id, organizationId } })
}

// GET /api/hr/training/[id] — ADMIN. Full module for the builder.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const trainingModule = await prisma.trainingModule.findFirst({
    where: { id, organizationId: access.org.id },
    include: moduleInclude,
  })
  if (!trainingModule) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(trainingModule)
}

// PATCH /api/hr/training/[id] — ADMIN. Quick status flips, or the full
// builder save: transaction-diff over lessons (delete removed / update
// existing / create new — templates pattern), wipe-and-recreate store
// assignments, and upsert-or-delete the module's single quiz row.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const existing = await findOrgModule(id, access.org.id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Quick status-only update (archive / activate)
  if (!("lessons" in body)) {
    const data: { isActive?: boolean; isArchived?: boolean } = {}
    if ("isActive" in body) data.isActive = !!body.isActive
    if ("isArchived" in body) data.isArchived = !!body.isArchived
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }
    const updated = await prisma.trainingModule.update({ where: { id }, data })
    return NextResponse.json(updated)
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const data = parsed.data

  const storeIds = data.appliesTo === "selected" ? data.storeIds : []

  try {
    const existingLessonIds = new Set(
      (
        await prisma.trainingLesson.findMany({
          where: { trainingModuleId: id },
          select: { id: true },
        })
      ).map((l) => l.id)
    )
    const incomingIds = new Set(
      data.lessons.map((l) => l.id).filter((lid): lid is string => !!lid && existingLessonIds.has(lid))
    )
    const idsToDelete = [...existingLessonIds].filter((lid) => !incomingIds.has(lid))
    const toUpdate = data.lessons.filter((l) => l.id && existingLessonIds.has(l.id))
    const toCreate = data.lessons.filter((l) => !l.id || !existingLessonIds.has(l.id))

    const lessonData = (l: z.infer<typeof lessonSchema>) => ({
      title: l.title,
      info: l.info || null,
      videoUrl: l.videoUrl || null,
      orderIndex: l.orderIndex,
    })

    const existingQuiz = await prisma.trainingQuiz.findFirst({
      where: { trainingModuleId: id },
    })

    const updated = await prisma.$transaction(async (tx) => {
      if (idsToDelete.length) {
        // Cascades resources (rows only — private blobs are never deleted).
        await tx.trainingLesson.deleteMany({ where: { id: { in: idsToDelete } } })
      }
      for (const l of toUpdate) {
        await tx.trainingLesson.update({ where: { id: l.id! }, data: lessonData(l) })
      }
      await tx.trainingModuleStoreAssignment.deleteMany({ where: { trainingModuleId: id } })

      // One quiz per module: upsert while it has questions, delete when the
      // admin empties it.
      if (data.quiz && data.quiz.questions.length) {
        if (existingQuiz) {
          await tx.trainingQuiz.update({
            where: { id: existingQuiz.id },
            data: { passThreshold: data.quiz.passThreshold, questions: data.quiz.questions },
          })
        } else {
          await tx.trainingQuiz.create({
            data: {
              trainingModuleId: id,
              passThreshold: data.quiz.passThreshold,
              questions: data.quiz.questions,
            },
          })
        }
      } else if (existingQuiz) {
        await tx.trainingQuiz.delete({ where: { id: existingQuiz.id } })
      }

      return tx.trainingModule.update({
        where: { id },
        data: {
          title: data.title,
          subject: data.subject || null,
          description: data.description || null,
          appliesTo: storeIds.length ? "selected" : "all",
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          lessons: toCreate.length ? { create: toCreate.map(lessonData) } : undefined,
          storeAssignments: storeIds.length
            ? { create: storeIds.map((sid) => ({ storeId: sid })) }
            : undefined,
        },
        include: moduleInclude,
      })
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error("Failed to update training module", err)
    return NextResponse.json({ error: "Failed to save training module" }, { status: 500 })
  }
}

// DELETE /api/hr/training/[id] — ADMIN. Cascades lessons/resources/quiz rows.
// Blocked once assignments exist (HR-7 records must survive) — archive instead.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const existing = await findOrgModule(id, access.org.id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const assignmentCount = await prisma.trainingAssignment.count({
    where: { trainingModuleId: id },
  })
  if (assignmentCount > 0) {
    return NextResponse.json(
      { error: "This module has training records — archive it instead" },
      { status: 409 }
    )
  }

  await prisma.trainingModule.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
