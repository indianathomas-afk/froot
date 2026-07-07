import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { ingredientDisplayName, requireCountsContext, userNamesById } from "@/lib/count-access"

const CreateSchema = z.object({
  storeId: z.string().min(1),
})

// GET /api/inventory/counts?storeId=&status= — newest-first count list for the
// inventory home. Rows carry everything the overview header + history timeline
// need: value, counted-by, partial/corrections badges, draft progress.
export async function GET(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const status = url.searchParams.get("status")

  if (storeId && !ctx.isAdmin && !ctx.storeIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const counts = await prisma.inventoryCount.findMany({
    where: {
      organizationId: ctx.org.id,
      ...(storeId ? { storeId } : ctx.isAdmin ? {} : { storeId: { in: ctx.storeIds } }),
      ...(status ? { status } : {}),
    },
    include: {
      store: true,
      lines: { select: { quantityCounted: true, costPerReportingUnit: true } },
      _count: { select: { corrections: true } },
    },
    orderBy: [{ finalizedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }],
  })

  const names = await userNamesById(counts.flatMap((c) => c.completedByUserIds))

  return NextResponse.json({
    counts: counts.map((c) => {
      const counted = c.lines.filter((l) => l.quantityCounted !== null)
      const draftValue = counted.reduce((sum, l) => sum + (l.quantityCounted ?? 0) * l.costPerReportingUnit, 0)
      return {
        id: c.id,
        storeId: c.storeId,
        storeName: c.store.name,
        name: c.name,
        status: c.status,
        isPartial: c.isPartial,
        startedAt: c.startedAt.toISOString(),
        finalizedAt: c.finalizedAt ? c.finalizedAt.toISOString() : null,
        sittingInventoryVal: c.sittingInventoryVal,
        draftValue,
        linesCounted: counted.length,
        linesTotal: c.lines.length,
        correctionsCount: c._count.corrections,
        countedByNames: c.completedByUserIds.map((id) => names.get(id)).filter((n): n is string => !!n),
      }
    }),
  })
}

// POST /api/inventory/counts {storeId} → new Draft with lines snapshotted from
// the store's storage areas (one line per area assignment; name/unit/cost frozen
// at count start). One Draft per store — a duplicate create is a 409 pointing at
// the existing draft so the UI can resume it.
export async function POST(req: Request) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const body = await req.json()
  const data = CreateSchema.parse(body)

  if (!ctx.isAdmin && !ctx.storeIds.includes(data.storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: data.storeId, organizationId: ctx.org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const existingDraft = await prisma.inventoryCount.findFirst({
    where: { organizationId: ctx.org.id, storeId: data.storeId, status: "Draft" },
  })
  if (existingDraft) {
    return NextResponse.json(
      { error: "A draft count is already in progress for this store", draftId: existingDraft.id },
      { status: 409 }
    )
  }

  const areas = await prisma.storageArea.findMany({
    where: { organizationId: ctx.org.id, storeId: data.storeId },
    include: {
      ingredientMappings: {
        include: { ingredient: true },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  })

  const lines = areas.flatMap((area) =>
    area.ingredientMappings
      .filter((m) => m.ingredient.deletedAt === null && !m.ingredient.isArchived)
      .map((m) => ({
        storageAreaId: area.id,
        ingredientId: m.ingredientId,
        ingredientName: ingredientDisplayName(m.ingredient),
        reportingUnit: m.ingredient.reportingUnit,
        costPerReportingUnit: m.ingredient.costPerReportingUnit,
        sortOrder: m.sortOrder,
      }))
  )

  const count = await prisma.inventoryCount.create({
    data: {
      organizationId: ctx.org.id,
      storeId: data.storeId,
      status: "Draft",
      completedByUserIds: ctx.dbUser ? [ctx.dbUser.id] : [],
      lines: { create: lines },
    },
  })

  return NextResponse.json({ id: count.id, storeId: count.storeId, status: count.status }, { status: 201 })
}
