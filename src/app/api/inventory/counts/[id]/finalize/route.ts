import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin } from "@/lib/auth"
import { requireCount } from "@/lib/count-access"

const FinalizeSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Defines the inventory period boundary; defaults to the last line edit time.
  finalizedAt: z.string().datetime().optional(),
  // Partial counts are excluded from usage/COGS period math (I-5) and never
  // become the sitting-inventory figure.
  isPartial: z.boolean().optional(),
})

// POST /api/inventory/counts/[id]/finalize (manager/admin) — freeze the count:
// lineValue = qty × snapshot cost, total → sittingInventoryVal. Idempotent: a
// repeat call returns the already-finalized count untouched.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count, dbUser } = ctx

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (count.status === "Finalized") {
    return NextResponse.json({
      id: count.id,
      status: count.status,
      sittingInventoryVal: count.sittingInventoryVal,
      finalizedAt: count.finalizedAt?.toISOString() ?? null,
    })
  }

  const body = await req.json().catch(() => ({}))
  const data = FinalizeSchema.parse(body)

  const lines = await prisma.inventoryCountLine.findMany({ where: { inventoryCountId: count.id } })

  // Uncounted lines finalize as zero on hand — the sheet is the record of what
  // was (and wasn't) found on the shelf.
  const valued = lines.map((l) => ({
    id: l.id,
    lineValue: (l.quantityCounted ?? 0) * l.costPerReportingUnit,
  }))
  const total = valued.reduce((sum, l) => sum + l.lineValue, 0)

  const lastEdit = lines.reduce<Date | null>(
    (max, l) => (l.countedAt && (!max || l.countedAt > max) ? l.countedAt : max),
    null
  )
  const finalizedAt = data.finalizedAt ? new Date(data.finalizedAt) : lastEdit ?? new Date()

  const updated = await prisma.$transaction(async (tx) => {
    for (const l of valued) {
      await tx.inventoryCountLine.update({ where: { id: l.id }, data: { lineValue: l.lineValue } })
    }
    return tx.inventoryCount.update({
      where: { id: count.id },
      data: {
        status: "Finalized",
        finalizedAt,
        sittingInventoryVal: total,
        name: data.name !== undefined ? data.name || null : count.name,
        notes: data.notes !== undefined ? data.notes || null : count.notes,
        isPartial: data.isPartial ?? count.isPartial,
        ...(dbUser && !count.completedByUserIds.includes(dbUser.id)
          ? { completedByUserIds: { push: dbUser.id } }
          : {}),
      },
    })
  })

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    sittingInventoryVal: updated.sittingInventoryVal,
    finalizedAt: updated.finalizedAt?.toISOString() ?? null,
  })
}
