import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { ingredientDisplayName, requireCount } from "@/lib/count-access"

const BatchSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        quantityCounted: z.number().nonnegative().nullable(),
      })
    )
    .min(1),
})

const AddSchema = z.object({
  additions: z
    .array(
      z.object({
        storageAreaId: z.string().min(1),
        ingredientId: z.string().min(1),
      })
    )
    .min(1),
})

// PATCH /api/inventory/counts/[id]/lines — batch quantity upsert, autosave-
// friendly: the client debounces and retries, and multiple users can flush
// batches for different areas of the same draft concurrently.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count, dbUser } = ctx

  if (count.status !== "Draft") {
    return NextResponse.json({ error: "Count is finalized — use corrections instead" }, { status: 409 })
  }

  const body = await req.json()
  const data = BatchSchema.parse(body)

  const lineIds = data.lines.map((l) => l.lineId)
  const existing = await prisma.inventoryCountLine.findMany({
    where: { id: { in: lineIds }, inventoryCountId: count.id },
  })
  const existingById = new Map(existing.map((l) => [l.id, l]))
  if (existing.length !== new Set(lineIds).size) {
    return NextResponse.json({ error: "One or more lines do not belong to this count" }, { status: 400 })
  }

  const now = new Date()
  await prisma.$transaction([
    ...data.lines.map((l) => {
      const current = existingById.get(l.lineId)!
      return prisma.inventoryCountLine.update({
        where: { id: l.lineId },
        data: {
          quantityCounted: l.quantityCounted,
          // First-entry timestamp — it defines the "order you just counted" used
          // by sheet-to-shelf re-sort, so edits don't shuffle it.
          countedAt: l.quantityCounted === null ? null : current.countedAt ?? now,
        },
      })
    }),
    ...(dbUser && !count.completedByUserIds.includes(dbUser.id)
      ? [
          prisma.inventoryCount.update({
            where: { id: count.id },
            data: { completedByUserIds: { push: dbUser.id } },
          }),
        ]
      : []),
  ])

  return NextResponse.json({ saved: data.lines.length })
}

// POST /api/inventory/counts/[id]/lines — mid-count add ("add & count") and the
// unassigned-ingredient triage panel. Creates the storage-area mapping when it's
// missing (appended at the end of the area's order) and snapshots a fresh line,
// so fixing setup never means leaving the draft. Open to anyone who can count.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count, org } = ctx

  if (count.status !== "Draft") {
    return NextResponse.json({ error: "Count is finalized" }, { status: 409 })
  }

  const body = await req.json()
  const data = AddSchema.parse(body)

  const areaIds = [...new Set(data.additions.map((a) => a.storageAreaId))]
  const areas = await prisma.storageArea.findMany({
    where: { id: { in: areaIds }, organizationId: org.id, storeId: count.storeId },
    include: { ingredientMappings: true },
  })
  if (areas.length !== areaIds.length) {
    return NextResponse.json({ error: "Storage area not found in this store" }, { status: 404 })
  }
  const areaById = new Map(areas.map((a) => [a.id, a]))

  const ingredientIds = [...new Set(data.additions.map((a) => a.ingredientId))]
  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds }, organizationId: org.id, deletedAt: null, isArchived: false },
  })
  if (ingredients.length !== ingredientIds.length) {
    return NextResponse.json({ error: "Ingredient not found or not active" }, { status: 404 })
  }
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))

  const existingLines = await prisma.inventoryCountLine.findMany({ where: { inventoryCountId: count.id } })

  const created: string[] = []
  for (const add of data.additions) {
    const area = areaById.get(add.storageAreaId)!
    const ingredient = ingredientById.get(add.ingredientId)!

    const alreadyLine = existingLines.some(
      (l) => l.storageAreaId === add.storageAreaId && l.ingredientId === add.ingredientId
    )
    if (alreadyLine) continue

    const mapping = area.ingredientMappings.find((m) => m.ingredientId === add.ingredientId)
    const nextSort = Math.max(-1, ...area.ingredientMappings.map((m) => m.sortOrder)) + 1

    const [, line] = await prisma.$transaction([
      mapping
        ? prisma.ingredientStorageMapping.update({ where: { id: mapping.id }, data: {} })
        : prisma.ingredientStorageMapping.create({
            data: { storageAreaId: area.id, ingredientId: ingredient.id, sortOrder: nextSort },
          }),
      prisma.inventoryCountLine.create({
        data: {
          inventoryCountId: count.id,
          storageAreaId: area.id,
          ingredientId: ingredient.id,
          ingredientName: ingredientDisplayName(ingredient),
          reportingUnit: ingredient.reportingUnit,
          costPerReportingUnit: ingredient.costPerReportingUnit,
          sortOrder: mapping ? mapping.sortOrder : nextSort,
        },
      }),
    ])
    created.push(line.id)
    if (!mapping) area.ingredientMappings.push({ id: "new", storageAreaId: area.id, ingredientId: ingredient.id, sortOrder: nextSort })
  }

  return NextResponse.json({ created: created.length, lineIds: created }, { status: 201 })
}
