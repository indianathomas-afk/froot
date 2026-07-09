import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import { ALLOWED_EMOJI } from "@/lib/messages"

async function loadContext(id: string, emojiParam: string) {
  const ctx = await getCurrentUser()
  const emoji = decodeURIComponent(emojiParam)
  if (!(ALLOWED_EMOJI as readonly string[]).includes(emoji)) {
    return { error: NextResponse.json({ error: "Emoji not allowed" }, { status: 400 }) }
  }
  if (!ctx.dbUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const message = await prisma.teamMessage.findFirst({
    where: { id, organizationId: ctx.org.id, deletedAt: null },
  })
  if (!message) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(message.storeId)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { userId: ctx.dbUser.id, emoji }
}

// PUT /api/messages/[id]/reactions/[emoji] — add own reaction (idempotent).
export async function PUT(_req: Request, { params }: { params: Promise<{ id: string; emoji: string }> }) {
  const { id, emoji: emojiParam } = await params
  let loaded: Awaited<ReturnType<typeof loadContext>>
  try {
    loaded = await loadContext(id, emojiParam)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ("error" in loaded) return loaded.error
  const { userId, emoji } = loaded

  await prisma.messageReaction.upsert({
    where: { messageId_userId_emoji: { messageId: id, userId, emoji } },
    update: {},
    create: { messageId: id, userId, emoji },
  })
  return NextResponse.json({ success: true })
}

// DELETE /api/messages/[id]/reactions/[emoji] — remove own reaction.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; emoji: string }> }) {
  const { id, emoji: emojiParam } = await params
  let loaded: Awaited<ReturnType<typeof loadContext>>
  try {
    loaded = await loadContext(id, emojiParam)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ("error" in loaded) return loaded.error
  const { userId, emoji } = loaded

  await prisma.messageReaction.deleteMany({ where: { messageId: id, userId, emoji } })
  return NextResponse.json({ success: true })
}
