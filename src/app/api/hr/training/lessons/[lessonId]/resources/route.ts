import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { readHrFileMeta } from "@/lib/hr-files"
import {
  isOrgTrainingBlobUrl,
  requireHrTrainingAccess,
  TRAINING_RESOURCES_PER_LESSON,
  validateTrainingResourceMeta,
} from "../../../access"

const bodySchema = z.object({
  url: z.string().url(),
  label: z.string().trim().min(1),
})

// POST /api/hr/training/lessons/[lessonId]/resources — ADMIN. Third leg of
// the private upload: register the blob the browser just PUT. Content type
// and size come from the store via readHrFileMeta, never from the client,
// and the 4-per-lesson cap is enforced here — the UI cap is just courtesy.
export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response
  const { org } = access

  const { lessonId } = await params
  const lesson = await prisma.trainingLesson.findFirst({
    where: { id: lessonId, trainingModule: { organizationId: org.id } },
    include: { resources: { select: { id: true } } },
  })
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 })

  if (lesson.resources.length >= TRAINING_RESOURCES_PER_LESSON) {
    return NextResponse.json(
      { error: `A lesson can have at most ${TRAINING_RESOURCES_PER_LESSON} files` },
      { status: 400 }
    )
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  if (!isOrgTrainingBlobUrl(parsed.data.url, org.id)) {
    return NextResponse.json({ error: "Invalid resource file URL" }, { status: 400 })
  }

  let meta
  try {
    meta = await readHrFileMeta(parsed.data.url)
  } catch {
    return NextResponse.json({ error: "Uploaded file not found" }, { status: 400 })
  }

  const metaError = validateTrainingResourceMeta(meta.contentType, meta.sizeBytes)
  if (metaError) return NextResponse.json({ error: metaError }, { status: 400 })

  const resource = await prisma.trainingResource.create({
    data: {
      trainingLessonId: lesson.id,
      label: parsed.data.label,
      fileUrl: meta.url,
      contentType: meta.contentType,
      sizeBytes: meta.sizeBytes,
      orderIndex: lesson.resources.length,
    },
  })

  return NextResponse.json(resource, { status: 201 })
}
