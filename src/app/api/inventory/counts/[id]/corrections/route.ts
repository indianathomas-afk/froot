import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin } from "@/lib/auth"
import { requireCount } from "@/lib/count-access"

const CorrectionSchema = z
  .object({
    lineId: z.string().min(1),
    quantityCounted: z.number().nonnegative().optional(),
    costPerReportingUnit: z.number().nonnegative().optional(),
    note: z.string().min(1).max(500),
  })
  .refine((d) => d.quantityCounted !== undefined || d.costPerReportingUnit !== undefined, {
    message: "Provide quantityCounted and/or costPerReportingUnit",
  })

// POST /api/inventory/counts/[id]/corrections (manager/admin) — finalized counts
// are records, not tombstones: data-entry errors get fixed where they happened,
// with an audit row per changed field and the count total recomputed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireCount(id)
  if ("error" in ctx) return ctx.error
  const { count } = ctx

  let dbUser
  try {
    dbUser = await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (count.status !== "Finalized") {
    return NextResponse.json({ error: "Corrections apply to finalized counts — edit the draft directly" }, { status: 409 })
  }

  const body = await req.json()
  const data = CorrectionSchema.parse(body)

  const line = await prisma.inventoryCountLine.findFirst({
    where: { id: data.lineId, inventoryCountId: count.id },
  })
  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 })

  const newQuantity = data.quantityCounted ?? line.quantityCounted
  const newCost = data.costPerReportingUnit ?? line.costPerReportingUnit
  const newLineValue = (newQuantity ?? 0) * newCost

  const auditRows: { field: string; oldValue: number | null; newValue: number | null }[] = []
  if (data.quantityCounted !== undefined && data.quantityCounted !== line.quantityCounted) {
    auditRows.push({ field: "quantityCounted", oldValue: line.quantityCounted, newValue: data.quantityCounted })
  }
  if (data.costPerReportingUnit !== undefined && data.costPerReportingUnit !== line.costPerReportingUnit) {
    auditRows.push({ field: "costPerReportingUnit", oldValue: line.costPerReportingUnit, newValue: data.costPerReportingUnit })
  }
  if (auditRows.length === 0) {
    return NextResponse.json({ error: "No change — values match the current line" }, { status: 400 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.inventoryCountLine.update({
      where: { id: line.id },
      data: {
        quantityCounted: newQuantity,
        costPerReportingUnit: newCost,
        lineValue: newLineValue,
      },
    })
    await tx.inventoryCountCorrection.createMany({
      data: auditRows.map((r) => ({
        countId: count.id,
        lineId: line.id,
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        note: data.note,
        userId: dbUser?.id ?? "",
      })),
    })
    const total = await tx.inventoryCountLine.aggregate({
      where: { inventoryCountId: count.id },
      _sum: { lineValue: true },
    })
    return tx.inventoryCount.update({
      where: { id: count.id },
      data: { sittingInventoryVal: total._sum.lineValue ?? 0 },
    })
  })

  return NextResponse.json({
    lineId: line.id,
    quantityCounted: newQuantity,
    costPerReportingUnit: newCost,
    lineValue: newLineValue,
    sittingInventoryVal: updated.sittingInventoryVal,
    corrections: auditRows.length,
  })
}
