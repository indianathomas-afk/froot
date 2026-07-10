import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import {
  MESSAGE_TYPES,
  MESSAGE_STATUSES,
  SHIFT_PHASES,
  MAX_ATTACHMENTS,
  MAX_BODY_LENGTH,
  attachmentSchema,
  buildAttachmentRows,
  messageInclude,
  serializeMessage,
} from "@/lib/messages"

const createSchema = z.object({
  storeId: z.string().min(1),
  type: z.enum(MESSAGE_TYPES),
  body: z.string().trim().min(1).max(MAX_BODY_LENGTH),
  shiftPhase: z.enum(SHIFT_PHASES).nullish(),
  linkedIngredientId: z.string().nullish(),
  authorStaffId: z.string().nullish(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
})

// GET /api/messages?storeId=&type=&status=&shiftPhase=&before=&limit= — the
// store feed, newest first, cursor-paginated by createdAt.
export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const type = url.searchParams.get("type")
  const status = url.searchParams.get("status")
  const shiftPhase = url.searchParams.get("shiftPhase")
  const before = url.searchParams.get("before")
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100)

  const messages = await prisma.teamMessage.findMany({
    where: {
      storeId,
      deletedAt: null,
      ...(type && (MESSAGE_TYPES as readonly string[]).includes(type) ? { type } : {}),
      ...(status && (MESSAGE_STATUSES as readonly string[]).includes(status) ? { status } : {}),
      ...(shiftPhase && (SHIFT_PHASES as readonly string[]).includes(shiftPhase) ? { shiftPhase } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: messageInclude,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  })

  const page = messages.slice(0, limit)
  return NextResponse.json({
    messages: page.map((m) => serializeMessage(m, dbUser?.id ?? null)),
    nextCursor: messages.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
  })
}

// POST /api/messages — create a feed post. Handoff notes go through
// /api/checklists/[id]/handoff-messages instead.
export async function POST(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const data = parsed.data

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const store = await prisma.store.findFirst({ where: { id: data.storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  // shiftPhase only makes sense on shift notes; linked ingredient only on shortages.
  const shiftPhase = data.type === "shift_note" ? (data.shiftPhase ?? null) : null
  if (data.type === "shift_note" && !shiftPhase) {
    return NextResponse.json({ error: "shiftPhase is required for shift notes" }, { status: 400 })
  }
  let linkedIngredientId: string | null = null
  if (data.type === "shortage" && data.linkedIngredientId) {
    const ingredient = await prisma.ingredient.findFirst({
      where: { id: data.linkedIngredientId, organizationId: org.id, deletedAt: null },
    })
    if (!ingredient) return NextResponse.json({ error: "Ingredient not found" }, { status: 404 })
    linkedIngredientId = ingredient.id
  }

  let authorStaffId: string | null = null
  if (data.authorStaffId) {
    const staff = await prisma.staffMember.findFirst({
      where: { id: data.authorStaffId, organizationId: org.id },
    })
    if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
    authorStaffId = staff.id
  }

  let attachmentRows
  try {
    attachmentRows = buildAttachmentRows(data.attachments ?? [])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid attachment" }, { status: 400 })
  }

  const message = await prisma.teamMessage.create({
    data: {
      organizationId: org.id,
      storeId: data.storeId,
      authorUserId: dbUser?.id ?? null,
      authorStaffId,
      type: data.type,
      shiftPhase,
      body: data.body,
      linkedIngredientId,
      attachments: { create: attachmentRows },
      // The author has obviously read their own post.
      ...(dbUser ? { reads: { create: { userId: dbUser.id } } } : {}),
    },
    include: messageInclude,
  })

  return NextResponse.json(serializeMessage(message, dbUser?.id ?? null), { status: 201 })
}
