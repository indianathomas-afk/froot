import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireNutrition, type NutritionContext } from "@/lib/nutrition-access"
import { flOzError } from "@/lib/nutrition-label"

// PUT / DELETE /api/nutrition/items/[salesItemId]/serving — one item's label
// override (N-2, F3: "a per-item override that can set a volume, a serving
// size, or 'per item'"). It beats the size table and the org serving size.
// perItem = the whole item is one serving, so it carries no volume or
// serving. DELETE returns the item to the table/defaults. The sales item is
// resolved inside the caller's org, so another org's id is a 404. ADMIN
// (nutrition.manage). One AuditLog row per change, in the transaction.

const Schema = z.object({
  perItem: z.boolean(),
  volumeFlOz: z.number().nullable(),
  servingFlOz: z.number().nullable(),
})

async function findItem(orgId: string, salesItemId: string) {
  return prisma.salesItem.findFirst({
    where: { id: salesItemId, organizationId: orgId },
    select: { id: true, nutritionServing: { select: { perItem: true, volumeFlOz: true, servingFlOz: true } } },
  })
}

function audit(tx: Prisma.TransactionClient, ctx: NutritionContext, salesItemId: string, metadata: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: {
      organizationId: ctx.org.id,
      userId: ctx.dbUser?.clerkUserId ?? null,
      action: "nutrition.serving.item",
      entityType: "SalesItem",
      entityId: salesItemId,
      metadata,
    },
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ salesItemId: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { salesItemId } = await params

  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Expected { perItem, volumeFlOz, servingFlOz }" }, { status: 400 })
  const d = parsed.data
  if (d.perItem && (d.volumeFlOz !== null || d.servingFlOz !== null)) {
    return NextResponse.json({ error: "\"Per item\" means the whole item is one serving — leave volume and serving size empty" }, { status: 400 })
  }
  if (!d.perItem && d.volumeFlOz === null && d.servingFlOz === null) {
    return NextResponse.json({ error: "Nothing to override — set a volume, a serving size, or \"per item\"" }, { status: 400 })
  }
  for (const [v, what] of [[d.volumeFlOz, "Volume"], [d.servingFlOz, "Serving size"]] as const) {
    if (v === null) continue
    const err = flOzError(v, what)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const item = await findItem(ctx.org.id, salesItemId)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data = { perItem: d.perItem, volumeFlOz: d.volumeFlOz, servingFlOz: d.servingFlOz, updatedByUserId: ctx.dbUser?.id ?? null }
  await prisma.$transaction(async (tx) => {
    await tx.nutritionItemServing.upsert({
      where: { salesItemId: item.id },
      create: { organizationId: ctx.org.id, salesItemId: item.id, ...data },
      update: data,
    })
    await audit(tx, ctx, item.id, { from: item.nutritionServing, to: { perItem: d.perItem, volumeFlOz: d.volumeFlOz, servingFlOz: d.servingFlOz } })
  })
  return NextResponse.json({ success: true })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ salesItemId: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { salesItemId } = await params

  const item = await findItem(ctx.org.id, salesItemId)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (item.nutritionServing) {
    await prisma.$transaction(async (tx) => {
      await tx.nutritionItemServing.delete({ where: { salesItemId: item.id } })
      await audit(tx, ctx, item.id, { from: item.nutritionServing, to: null })
    })
  }
  return NextResponse.json({ success: true })
}
