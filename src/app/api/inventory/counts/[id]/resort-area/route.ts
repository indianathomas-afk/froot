import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { requireCount } from "@/lib/count-access"

const ResortSchema = z.object({
  storageAreaId: z.string().min(1),
})

// POST /api/inventory/counts/[id]/resort-area — sheet-to-shelf re-sort: reorder
// the area's saved ingredient order to match the order lines were actually
// counted (first-entry timestamps), so the next count sheet walks the shelf.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count, org } = ctx

  const body = await req.json()
  const data = ResortSchema.parse(body)

  const area = await prisma.storageArea.findFirst({
    where: { id: data.storageAreaId, organizationId: org.id, storeId: count.storeId },
    include: { ingredientMappings: true },
  })
  if (!area) return NextResponse.json({ error: "Storage area not found" }, { status: 404 })

  const lines = await prisma.inventoryCountLine.findMany({
    where: { inventoryCountId: count.id, storageAreaId: area.id },
  })
  if (lines.every((l) => l.countedAt === null)) {
    return NextResponse.json({ error: "Nothing counted in this area yet" }, { status: 400 })
  }

  // Counted lines in entry order first; uncounted lines keep their relative
  // sheet order at the end.
  const ordered = [...lines].sort((a, b) => {
    if (a.countedAt && b.countedAt) return a.countedAt.getTime() - b.countedAt.getTime()
    if (a.countedAt) return -1
    if (b.countedAt) return 1
    return a.sortOrder - b.sortOrder
  })

  const mappingByIngredient = new Map(area.ingredientMappings.map((m) => [m.ingredientId, m]))

  const ops: Prisma.PrismaPromise<unknown>[] = []
  ordered.forEach((line, index) => {
    ops.push(prisma.inventoryCountLine.update({ where: { id: line.id }, data: { sortOrder: index } }))
    const mapping = mappingByIngredient.get(line.ingredientId)
    if (mapping) {
      ops.push(prisma.ingredientStorageMapping.update({ where: { id: mapping.id }, data: { sortOrder: index } }))
    }
  })
  await prisma.$transaction(ops)

  return NextResponse.json({ reordered: ordered.length })
}
