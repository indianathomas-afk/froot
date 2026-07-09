import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import { messageInclude, serializeMessage } from "@/lib/messages"

const PREVIEW_COUNT = 3
const PREVIEW_BODY_CHARS = 140

// GET /api/dashboard/comms?storeId= — one call feeds both dashboard comms
// boxes: the Team Messages preview (latest 3 + unread count) and the active
// CORPORATE UPDATE (most recent published, unexpired pin, targeted at this
// store or all stores; null collapses the box).
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

  const now = new Date()
  const [latest, unreadCount, corporateUpdate] = await Promise.all([
    prisma.teamMessage.findMany({
      where: { storeId, deletedAt: null },
      include: messageInclude,
      orderBy: { createdAt: "desc" },
      take: PREVIEW_COUNT,
    }),
    dbUser
      ? prisma.teamMessage.count({
          where: {
            storeId,
            deletedAt: null,
            reads: { none: { userId: dbUser.id } },
          },
        })
      : Promise.resolve(0),
    prisma.corporateUpdate.findFirst({
      where: {
        organizationId: org.id,
        deletedAt: null,
        publishedAt: { not: null },
        OR: [{ pinnedUntil: null }, { pinnedUntil: { gt: now } }],
        AND: [{ OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: storeId } }] }],
      },
      include: { attachments: { orderBy: { createdAt: "asc" } } },
      orderBy: { publishedAt: "desc" },
    }),
  ])

  return NextResponse.json({
    teamMessagesPreview: {
      messages: latest.map((m) => {
        const s = serializeMessage(m, dbUser?.id ?? null)
        return {
          ...s,
          body: s.body.length > PREVIEW_BODY_CHARS ? `${s.body.slice(0, PREVIEW_BODY_CHARS - 1)}…` : s.body,
        }
      }),
      unreadCount,
    },
    corporateUpdate: corporateUpdate
      ? {
          id: corporateUpdate.id,
          title: corporateUpdate.title,
          body: corporateUpdate.body,
          publishedAt: corporateUpdate.publishedAt!.toISOString(),
          attachments: corporateUpdate.attachments.map((a) => ({
            id: a.id,
            kind: a.kind,
            url: a.url,
            filename: a.filename,
          })),
        }
      : null,
  })
}
