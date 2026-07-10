import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, getUserStoreScope } from "@/lib/auth"
import { MAX_ATTACHMENTS, attachmentSchema, buildAttachmentRows } from "@/lib/messages"

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  storeIds: z.array(z.string()).optional(), // empty/omitted = all stores
  pinnedUntil: z.string().datetime().nullish(),
  publish: z.boolean().default(true),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
})

function serializeUpdate(u: {
  id: string
  title: string
  body: string
  storeIds: string[]
  pinnedUntil: Date | null
  publishedAt: Date | null
  createdAt: Date
  authorUser?: { name: string | null; email: string } | null
  attachments?: { id: string; kind: string; url: string; filename: string | null }[]
}) {
  return {
    id: u.id,
    title: u.title,
    body: u.body,
    storeIds: u.storeIds,
    pinnedUntil: u.pinnedUntil?.toISOString() ?? null,
    publishedAt: u.publishedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    author: u.authorUser ? (u.authorUser.name ?? u.authorUser.email.split("@")[0]) : null,
    attachments: u.attachments ?? [],
  }
}

// GET /api/corporate-updates?before=&limit= — published updates visible to the
// caller's stores; admins also see drafts (for the composer).
export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org } = ctx
  const { isAdmin, storeIds } = await getUserStoreScope()

  const url = new URL(req.url)
  const before = url.searchParams.get("before")
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100)

  const updates = await prisma.corporateUpdate.findMany({
    where: {
      organizationId: org.id,
      deletedAt: null,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      ...(isAdmin
        ? {}
        : {
            publishedAt: { not: null },
            // Visible when targeted at all stores or at one of the caller's.
            OR: [{ storeIds: { isEmpty: true } }, { storeIds: { hasSome: storeIds } }],
          }),
    },
    include: {
      authorUser: { select: { name: true, email: true } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  })

  const page = updates.slice(0, limit)
  return NextResponse.json({
    updates: page.map(serializeUpdate),
    nextCursor: updates.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
  })
}

// POST /api/corporate-updates — admin only.
export async function POST(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx
  if (dbUser?.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const data = parsed.data

  // Only keep store ids that belong to this org.
  let storeIds: string[] = []
  if (data.storeIds && data.storeIds.length > 0) {
    const stores = await prisma.store.findMany({
      where: { organizationId: org.id, id: { in: data.storeIds } },
      select: { id: true },
    })
    storeIds = stores.map((s) => s.id)
  }

  let attachmentRows
  try {
    attachmentRows = buildAttachmentRows(data.attachments ?? [])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid attachment" }, { status: 400 })
  }

  const update = await prisma.corporateUpdate.create({
    data: {
      organizationId: org.id,
      authorUserId: dbUser.id,
      title: data.title,
      body: data.body,
      storeIds,
      pinnedUntil: data.pinnedUntil ? new Date(data.pinnedUntil) : null,
      publishedAt: data.publish ? new Date() : null,
      attachments: { create: attachmentRows },
    },
    include: {
      authorUser: { select: { name: true, email: true } },
      attachments: true,
    },
  })

  return NextResponse.json(serializeUpdate(update), { status: 201 })
}
