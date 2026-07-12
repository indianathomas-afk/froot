import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import {
  MESSAGE_STATUSES,
  MAX_BODY_LENGTH,
  EDIT_WINDOW_MS,
  messageInclude,
  serializeMessage,
} from "@/lib/messages"

const patchSchema = z.object({
  body: z.string().trim().min(1).max(MAX_BODY_LENGTH).optional(),
  status: z.enum(MESSAGE_STATUSES).optional(),
  acknowledged: z.boolean().optional(),
})

async function loadScopedMessage(id: string) {
  const ctx = await getCurrentUser()
  const message = await prisma.teamMessage.findFirst({
    where: { id, organizationId: ctx.org.id, deletedAt: null },
  })
  if (!message) return { ctx, message: null, allowed: false }
  const { isAdmin, storeIds } = await getUserStoreScope()
  return { ctx, message, allowed: isAdmin || storeIds.includes(message.storeId) }
}

// GET /api/messages/[id] — single message with attachments and reactions.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let scoped: Awaited<ReturnType<typeof loadScopedMessage>>
  try {
    scoped = await loadScopedMessage(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!scoped.message) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!scoped.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const full = await prisma.teamMessage.findUniqueOrThrow({
    where: { id },
    include: messageInclude,
  })
  return NextResponse.json(serializeMessage(full, scoped.ctx.dbUser?.id ?? null))
}

// PATCH /api/messages/[id] — edit body (author only, within 15 min), change
// status (manager/admin: open ↔ resolved ↔ archived), or acknowledge a
// handoff note (any store-scoped user — the receiving shift confirms they've
// seen it, which clears the note from checklist banners and the dashboard).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let scoped: Awaited<ReturnType<typeof loadScopedMessage>>
  try {
    scoped = await loadScopedMessage(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { ctx, message } = scoped
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!scoped.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const { body, status, acknowledged } = parsed.data
  const dbUser = ctx.dbUser
  const isManager = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  const data: {
    body?: string
    editedAt?: Date
    status?: string
    resolvedByUserId?: string | null
    resolvedAt?: Date | null
    acknowledgedAt?: Date | null
    acknowledgedByUserId?: string | null
  } = {}

  if (body !== undefined) {
    if (!dbUser || message.authorUserId !== dbUser.id) {
      return NextResponse.json({ error: "Only the author can edit a message" }, { status: 403 })
    }
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      return NextResponse.json({ error: "Edit window has closed (15 minutes)" }, { status: 403 })
    }
    data.body = body
    data.editedAt = new Date()
  }

  if (status !== undefined && status !== message.status) {
    if (!isManager) {
      return NextResponse.json({ error: "Only managers can change message status" }, { status: 403 })
    }
    data.status = status
    if (status === "resolved") {
      data.resolvedByUserId = dbUser?.id ?? null
      data.resolvedAt = new Date()
    } else if (status === "open") {
      data.resolvedByUserId = null
      data.resolvedAt = null
    }
  }

  if (acknowledged !== undefined) {
    if (!message.postedForDate) {
      return NextResponse.json({ error: "Only handoff notes can be acknowledged" }, { status: 400 })
    }
    if (acknowledged && !message.acknowledgedAt) {
      data.acknowledgedAt = new Date()
      data.acknowledgedByUserId = dbUser?.id ?? null
    } else if (!acknowledged && message.acknowledgedAt) {
      data.acknowledgedAt = null
      data.acknowledgedByUserId = null
    }
  }

  if (Object.keys(data).length === 0) {
    // Acknowledge is idempotent — a second tap returns the current state.
    if (acknowledged !== undefined) {
      const full = await prisma.teamMessage.findUniqueOrThrow({ where: { id }, include: messageInclude })
      return NextResponse.json(serializeMessage(full, dbUser?.id ?? null))
    }
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const updated = await prisma.teamMessage.update({ where: { id }, data, include: messageInclude })
  return NextResponse.json(serializeMessage(updated, dbUser?.id ?? null))
}

// DELETE /api/messages/[id] — soft delete; author or manager/admin.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let scoped: Awaited<ReturnType<typeof loadScopedMessage>>
  try {
    scoped = await loadScopedMessage(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { ctx, message } = scoped
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!scoped.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const dbUser = ctx.dbUser
  const isManager = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"
  const isAuthor = !!dbUser && message.authorUserId === dbUser.id
  if (!isManager && !isAuthor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await prisma.teamMessage.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ success: true })
}
