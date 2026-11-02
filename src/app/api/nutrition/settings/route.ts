import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { flOzError } from "@/lib/nutrition-label"

// PUT /api/nutrition/settings — the org's Nutrition Facts serving settings
// (N-2): the drink serving size (null = the 12 fl oz default, R-1) and the
// size table (F3: "the org size table keyed by the exact Square variation
// name"). `sizes` lists the rows to set; a null volume removes that name's
// row. Names are stored exactly as sent — the page sends them exactly as
// synced (F6). ADMIN (nutrition.manage). One AuditLog row in the transaction.

const Schema = z.object({
  servingFlOz: z.number().nullable(),
  sizes: z.array(z.object({ variationName: z.string().max(200), volumeFlOz: z.number().nullable() })).max(500),
})

export async function PUT(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error

  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Expected { servingFlOz, sizes }" }, { status: 400 })
  const { servingFlOz, sizes } = parsed.data

  if (servingFlOz !== null) {
    const err = flOzError(servingFlOz, "Serving size")
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }
  for (const s of sizes) {
    if (s.volumeFlOz === null) continue
    const err = flOzError(s.volumeFlOz, `"${s.variationName}"`)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }
  const names = sizes.map((s) => s.variationName)
  if (new Set(names).size !== names.length) return NextResponse.json({ error: "A size name is listed twice" }, { status: 400 })

  const orgId = ctx.org.id
  const before = await prisma.nutritionSizeVolume.findMany({ where: { organizationId: orgId }, select: { variationName: true, volumeFlOz: true } })
  const beforeByName = new Map(before.map((b) => [b.variationName, b.volumeFlOz]))
  const changed = sizes.filter((s) => (beforeByName.get(s.variationName) ?? null) !== s.volumeFlOz)

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: orgId }, data: { nutritionServingFlOz: servingFlOz } })
    for (const s of changed) {
      if (s.volumeFlOz === null) {
        await tx.nutritionSizeVolume.deleteMany({ where: { organizationId: orgId, variationName: s.variationName } })
      } else {
        await tx.nutritionSizeVolume.upsert({
          where: { organizationId_variationName: { organizationId: orgId, variationName: s.variationName } },
          create: { organizationId: orgId, variationName: s.variationName, volumeFlOz: s.volumeFlOz, updatedByUserId: ctx.dbUser?.id ?? null },
          update: { volumeFlOz: s.volumeFlOz, updatedByUserId: ctx.dbUser?.id ?? null },
        })
      }
    }
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        userId: ctx.dbUser?.clerkUserId ?? null,
        action: "nutrition.serving.settings",
        entityType: "Organization",
        entityId: orgId,
        metadata: {
          servingFlOz: { from: ctx.org.nutritionServingFlOz, to: servingFlOz },
          sizes: changed.map((s) => ({ variationName: s.variationName, from: beforeByName.get(s.variationName) ?? null, to: s.volumeFlOz })),
        },
      },
    })
  })

  return NextResponse.json({ success: true, changedSizes: changed.length })
}
