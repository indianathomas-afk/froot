import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sanitizeRichText } from "@/lib/sanitize-html"
import {
  isOrgTrainingBlobUrl,
  requireHrTrainingAccess,
  TRAINING_RESOURCES_PER_LESSON,
  validateTrainingResourceMeta,
} from "./access"
import { quizSchema } from "./schemas"

// Resources appear in a create payload only when duplicating a module — the
// rows are cloned pointing at the SAME private blobs (HR never deletes blobs,
// so sharing is safe). Fresh uploads go through the resource routes instead.
const resourceSchema = z.object({
  label: z.string().trim().min(1),
  fileUrl: z.string().url(),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  orderIndex: z.number().int().min(0).default(0),
})

const lessonSchema = z.object({
  title: z.string().trim().min(1),
  info: z.string().nullish(),
  videoUrl: z.string().nullish(),
  orderIndex: z.number().int().min(0).default(0),
  resources: z.array(resourceSchema).max(TRAINING_RESOURCES_PER_LESSON).default([]),
})

const createSchema = z.object({
  title: z.string().trim().min(1),
  subject: z.string().nullish(),
  categoryId: z.string().nullish(),
  description: z.string().nullish(),
  appliesTo: z.enum(["all", "selected"]).default("all"),
  storeIds: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  lessons: z.array(lessonSchema).default([]),
  quiz: quizSchema.nullish(),
})

const moduleInclude = {
  // HR-21: the joined category is what both page views render (name + colour
  // via preset key) — a rename or recolor propagates through this join alone.
  category: { select: { id: true, name: true, colorKey: true } },
  lessons: {
    orderBy: { orderIndex: "asc" as const },
    include: { resources: { orderBy: { orderIndex: "asc" as const } } },
  },
  quizzes: true,
  storeAssignments: true,
}

// GET /api/hr/training — ADMIN. Full modules (lessons, resources, quiz,
// store assignments) so the list can render counts and duplicate can clone.
export async function GET() {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const modules = await prisma.trainingModule.findMany({
    where: { organizationId: access.org.id },
    include: moduleInclude,
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(modules)
}

// PATCH /api/hr/training — ADMIN. Bulk archive/unarchive/activate.
export async function PATCH(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { ids, isActive, isArchived } = await req.json().catch(() => ({}))
  if (!Array.isArray(ids)) return NextResponse.json({ error: "ids required" }, { status: 400 })

  const data: { isActive?: boolean; isArchived?: boolean } = {}
  if (isActive !== undefined) data.isActive = isActive
  if (isArchived !== undefined) data.isArchived = isArchived

  await prisma.trainingModule.updateMany({
    where: { id: { in: ids }, organizationId: access.org.id },
    data,
  })
  return NextResponse.json({ ok: true })
}

// POST /api/hr/training — ADMIN. Create a module (builder save or duplicate).
export async function POST(req: Request) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response
  const { org } = access

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const body = parsed.data

  // Cloned resource rows must stay inside this org's private training
  // namespace and within the training file limits.
  for (const lesson of body.lessons) {
    for (const r of lesson.resources) {
      if (!isOrgTrainingBlobUrl(r.fileUrl, org.id)) {
        return NextResponse.json({ error: "Invalid resource file URL" }, { status: 400 })
      }
      const metaError = validateTrainingResourceMeta(r.contentType, r.sizeBytes)
      if (metaError) return NextResponse.json({ error: metaError }, { status: 400 })
    }
  }

  const storeIds = body.appliesTo === "selected" ? body.storeIds : []

  // HR-20 rider (PERM-7's class, audit §9 item 1): every submitted store id
  // must belong to this org — a foreign or nonexistent id would silently
  // shrink the module's reach via TrainingModuleStoreAssignment.
  if (storeIds.length) {
    const owned = await prisma.store.count({
      where: { id: { in: storeIds }, organizationId: org.id },
    })
    if (owned !== new Set(storeIds).size) {
      return NextResponse.json({ error: "Invalid store ids" }, { status: 400 })
    }
  }

  // HR-20: a category, when given, must be one of this org's.
  if (body.categoryId) {
    const category = await prisma.trainingCategory.findFirst({
      where: { id: body.categoryId, organizationId: org.id },
      select: { id: true },
    })
    if (!category) return NextResponse.json({ error: "Invalid category" }, { status: 400 })
  }

  const created = await prisma.trainingModule.create({
    data: {
      organizationId: org.id,
      title: body.title,
      subject: body.subject || null,
      categoryId: body.categoryId || null,
      // HR-28: the description is rich text now, so it is sanitized HERE, on
      // the way into the column — a payload is just JSON and the client's
      // cleanliness proves nothing. Also covers duplicate, which re-POSTs the
      // source module's description through this same route.
      description: sanitizeRichText(body.description),
      appliesTo: storeIds.length ? "selected" : "all",
      isActive: body.isActive,
      lessons: {
        create: body.lessons.map((l) => ({
          title: l.title,
          info: l.info || null,
          videoUrl: l.videoUrl || null,
          orderIndex: l.orderIndex,
          resources: l.resources.length
            ? {
                create: l.resources.map((r) => ({
                  label: r.label,
                  fileUrl: r.fileUrl,
                  contentType: r.contentType,
                  sizeBytes: r.sizeBytes,
                  orderIndex: r.orderIndex,
                })),
              }
            : undefined,
        })),
      },
      quizzes:
        body.quiz && body.quiz.questions.length
          ? { create: { passThreshold: body.quiz.passThreshold, questions: body.quiz.questions } }
          : undefined,
      storeAssignments: storeIds.length
        ? { create: storeIds.map((sid) => ({ storeId: sid })) }
        : undefined,
    },
    include: moduleInclude,
  })

  return NextResponse.json(created, { status: 201 })
}
