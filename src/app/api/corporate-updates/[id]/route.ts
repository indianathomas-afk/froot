import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(5000).optional(),
  storeIds: z.array(z.string()).optional(),
  pinnedUntil: z.string().datetime().nullish(),
  publish: z.boolean().optional(),
})

async function requireAdminAndUpdate(id: string) {
  const ctx = await getCurrentUser()
  if (ctx.dbUser?.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
  const update = await prisma.corporateUpdate.findFirst({
    where: { id, organizationId: ctx.org.id, deletedAt: null },
  })
  if (!update) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  return { ctx, update }
}

// PATCH /api/corporate-updates/[id] — admin: edit, publish a draft, or change
// the pin window.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let loaded: Awaited<ReturnType<typeof requireAdminAndUpdate>>
  try {
    loaded = await requireAdminAndUpdate(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ("error" in loaded) return loaded.error
  const { ctx, update } = loaded

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const data = parsed.data

  let storeIds: string[] | undefined
  if (data.storeIds !== undefined) {
    if (data.storeIds.length === 0) storeIds = []
    else {
      const stores = await prisma.store.findMany({
        where: { organizationId: ctx.org.id, id: { in: data.storeIds } },
        select: { id: true },
      })
      storeIds = stores.map((s) => s.id)
    }
  }

  const updated = await prisma.corporateUpdate.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(storeIds !== undefined ? { storeIds } : {}),
      ...(data.pinnedUntil !== undefined ? { pinnedUntil: data.pinnedUntil ? new Date(data.pinnedUntil) : null } : {}),
      // publish: true publishes a draft (idempotent); publish: false unpublishes.
      ...(data.publish === true && !update.publishedAt ? { publishedAt: new Date() } : {}),
      ...(data.publish === false ? { publishedAt: null } : {}),
    },
  })

  return NextResponse.json(updated)
}

// DELETE /api/corporate-updates/[id] — admin, soft delete.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let loaded: Awaited<ReturnType<typeof requireAdminAndUpdate>>
  try {
    loaded = await requireAdminAndUpdate(id)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ("error" in loaded) return loaded.error

  await prisma.corporateUpdate.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ success: true })
}
