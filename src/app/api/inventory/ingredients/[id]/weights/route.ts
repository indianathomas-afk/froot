import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireCountsContext } from "@/lib/count-access"

const WeightsSchema = z
  .object({
    // Stored in oz (dry); the count UI converts from lbs/oz/g/kg before sending.
    tareWeightOz: z.number().nonnegative().nullable().optional(),
    fullWeightOz: z.number().positive().nullable().optional(),
  })
  .refine((d) => d.tareWeightOz !== undefined || d.fullWeightOz !== undefined, {
    message: "Provide tareWeightOz and/or fullWeightOz",
  })

// PATCH /api/inventory/ingredients/[id]/weights — container tare/full weights
// for count-by-weighing. Deliberately open to any signed-in store user (not just
// managers): weights get captured standing at the scale mid-count.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCountsContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params
  const existing = await prisma.ingredient.findFirst({ where: { id, organizationId: ctx.org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const data = WeightsSchema.parse(body)

  const tare = data.tareWeightOz !== undefined ? data.tareWeightOz : existing.tareWeightOz
  const full = data.fullWeightOz !== undefined ? data.fullWeightOz : existing.fullWeightOz
  if (tare !== null && full !== null && full <= tare) {
    return NextResponse.json({ error: "Full container weight must be greater than the empty (tare) weight" }, { status: 400 })
  }

  const updated = await prisma.ingredient.update({
    where: { id },
    data: {
      ...(data.tareWeightOz !== undefined && { tareWeightOz: data.tareWeightOz }),
      ...(data.fullWeightOz !== undefined && { fullWeightOz: data.fullWeightOz }),
      lastEditedByUserId: ctx.dbUser?.id ?? null,
    },
  })

  return NextResponse.json({ id: updated.id, tareWeightOz: updated.tareWeightOz, fullWeightOz: updated.fullWeightOz })
}
