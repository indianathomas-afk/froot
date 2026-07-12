import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import { messageInclude, serializeMessage, youTubeVideoId, activeHandoffNotesWhere } from "@/lib/messages"
import { localDateStr } from "@/lib/reports"

const PREVIEW_COUNT = 3
const PREVIEW_BODY_CHARS = 140

// GET /api/dashboard/comms?storeId= — one call feeds the dashboard comms
// boxes: the Team Messages preview (latest 3 + unread count), the active
// CORPORATE UPDATE (most recent published, unexpired pin, targeted at this
// store or all stores; null collapses the box), and shiftNotes — every
// unacknowledged handoff note surfacing today (store-local) for the "Notes
// for this shift" card. No template filter: notes whose target template no
// longer generates checklists still show here rather than being dropped.
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
  const today = localDateStr(now, store.timezone)
  const [latest, unreadCount, corporateUpdate, shiftNotes] = await Promise.all([
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
    prisma.teamMessage.findMany({
      where: activeHandoffNotesWhere({ storeId, day: today }),
      include: messageInclude,
      orderBy: { createdAt: "asc" },
    }),
  ])

  return NextResponse.json({
    shiftNotes: shiftNotes.map((m) => serializeMessage(m, dbUser?.id ?? null)),
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
            youtubeId: a.kind === "youtube" ? youTubeVideoId(a.url) : null,
          })),
        }
      : null,
  })
}
