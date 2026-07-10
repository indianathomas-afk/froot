import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import {
  MESSAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_BODY_LENGTH,
  HANDOFF_MAX_AGE_DAYS,
  attachmentSchema,
  buildAttachmentRows,
  phaseToShiftPhase,
  resolvePostedForDate,
  messageInclude,
  serializeMessage,
} from "@/lib/messages"

const createSchema = z.object({
  postedToTemplateId: z.string().min(1),
  body: z.string().trim().min(1).max(MAX_BODY_LENGTH),
  type: z.enum(MESSAGE_TYPES).optional(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
})

async function loadScopedChecklist(id: string) {
  const ctx = await getCurrentUser()
  const checklist = await prisma.checklist.findFirst({
    where: { id, organizationId: ctx.org.id },
    include: { template: { select: { id: true, operationalPhase: true } } },
  })
  if (!checklist) return { ctx, checklist: null, allowed: false }
  const { isAdmin, storeIds } = await getUserStoreScope()
  return { ctx, checklist, allowed: isAdmin || storeIds.includes(checklist.storeId) }
}

// GET /api/checklists/[id]/handoff-messages — "Notes from the last shift" for
// this instance: notes posted to its template for its date. Viewing marks them
// read for the current user. Notes older than 7 days never render here (they
// stay in the feed) to avoid stale banners.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let scoped: Awaited<ReturnType<typeof loadScopedChecklist>>
  try {
    scoped = await loadScopedChecklist(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { ctx, checklist } = scoped
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!scoped.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const minCreatedAt = new Date(Date.now() - HANDOFF_MAX_AGE_DAYS * 86400000)
  // Checklist.date is a DateTime; postedForDate is a DATE — normalize to the
  // calendar day before comparing.
  const instanceDay = new Date(`${checklist.date.toISOString().slice(0, 10)}T00:00:00.000Z`)
  const messages = await prisma.teamMessage.findMany({
    where: {
      storeId: checklist.storeId,
      postedToTemplateId: checklist.templateId,
      postedForDate: instanceDay,
      deletedAt: null,
      createdAt: { gte: minCreatedAt },
    },
    include: messageInclude,
    orderBy: { createdAt: "asc" },
  })

  if (ctx.dbUser && messages.length > 0) {
    await prisma.messageRead.createMany({
      data: messages.map((m) => ({ messageId: m.id, userId: ctx.dbUser!.id })),
      skipDuplicates: true,
    })
  }

  return NextResponse.json({ messages: messages.map((m) => serializeMessage(m, ctx.dbUser?.id ?? null)) })
}

// POST /api/checklists/[id]/handoff-messages — "Leave a note for the next
// shift". The client sends only the target template; the server computes
// postedForDate from the day sequence (later slot → today, earlier/equal →
// tomorrow) so users never think about dates.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let scoped: Awaited<ReturnType<typeof loadScopedChecklist>>
  try {
    scoped = await loadScopedChecklist(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { ctx, checklist } = scoped
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!scoped.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const data = parsed.data

  // Target must be an active template of this org, available to this store.
  const target = await prisma.template.findFirst({
    where: {
      id: data.postedToTemplateId,
      organizationId: ctx.org.id,
      isActive: true,
      isArchived: false,
      OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: checklist.storeId } } }],
    },
    select: { id: true, operationalPhase: true },
  })
  if (!target) return NextResponse.json({ error: "Target checklist not found" }, { status: 404 })

  let attachmentRows
  try {
    attachmentRows = buildAttachmentRows(data.attachments ?? [])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid attachment" }, { status: 400 })
  }

  const sourceDate = checklist.date.toISOString().slice(0, 10)
  const postedForDate = resolvePostedForDate(
    sourceDate,
    checklist.template.operationalPhase,
    target.operationalPhase
  )

  const message = await prisma.teamMessage.create({
    data: {
      organizationId: ctx.org.id,
      storeId: checklist.storeId,
      authorUserId: ctx.dbUser?.id ?? null,
      type: data.type ?? "shift_note",
      shiftPhase: phaseToShiftPhase(checklist.template.operationalPhase),
      body: data.body,
      postedToTemplateId: target.id,
      postedForDate: new Date(`${postedForDate}T00:00:00.000Z`),
      sourceChecklistId: checklist.id,
      attachments: { create: attachmentRows },
      ...(ctx.dbUser ? { reads: { create: { userId: ctx.dbUser.id } } } : {}),
    },
    include: messageInclude,
  })

  return NextResponse.json(serializeMessage(message, ctx.dbUser?.id ?? null), { status: 201 })
}
