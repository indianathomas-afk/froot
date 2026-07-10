import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"

const schema = z.object({
  storeId: z.string().min(1),
  upTo: z.string().datetime(),
})

// POST /api/messages/mark-read — bulk-marks the store feed read up to a
// timestamp; far cheaper than a write per message row.
export async function POST(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const { storeId, upTo } = parsed.data

  const { isAdmin, storeIds } = await getUserStoreScope()
  if (!isAdmin && !storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const unread = await prisma.teamMessage.findMany({
    where: {
      organizationId: org.id,
      storeId,
      deletedAt: null,
      createdAt: { lte: new Date(upTo) },
      reads: { none: { userId: dbUser.id } },
    },
    select: { id: true },
  })

  if (unread.length > 0) {
    await prisma.messageRead.createMany({
      data: unread.map((m) => ({ messageId: m.id, userId: dbUser.id })),
      skipDuplicates: true,
    })
  }

  return NextResponse.json({ marked: unread.length })
}
