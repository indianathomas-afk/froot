import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const MergeSchema = z.object({
  survivorId: z.string().min(1),
  mergedId: z.string().min(1),
})

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  let dbUser
  try {
    dbUser = await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { survivorId, mergedId } = MergeSchema.parse(body)
  if (survivorId === mergedId) return NextResponse.json({ error: "Pick two different ingredients" }, { status: 400 })

  const [survivor, merged] = await Promise.all([
    prisma.ingredient.findFirst({ where: { id: survivorId, organizationId: org.id, deletedAt: null } }),
    prisma.ingredient.findFirst({ where: { id: mergedId, organizationId: org.id, deletedAt: null } }),
  ])
  if (!survivor || !merged) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    const mergedVendorRows = await tx.vendorIngredient.findMany({ where: { ingredientId: mergedId } })
    const survivorVendorIds = new Set(
      (await tx.vendorIngredient.findMany({ where: { ingredientId: survivorId }, select: { vendorId: true } })).map(
        (v) => v.vendorId
      )
    )

    for (const row of mergedVendorRows) {
      if (survivorVendorIds.has(row.vendorId)) {
        // Survivor already prices this vendor — drop the merged duplicate.
        await tx.vendorIngredient.delete({ where: { id: row.id } })
      } else {
        await tx.vendorIngredient.update({ where: { id: row.id }, data: { ingredientId: survivorId } })
      }
    }

    await tx.purchaseOrderLine.updateMany({ where: { ingredientId: mergedId }, data: { ingredientId: survivorId } })

    await tx.ingredient.update({
      where: { id: mergedId },
      data: { deletedAt: new Date(), lastEditedByUserId: dbUser?.id ?? null },
    })
  })

  return NextResponse.json({ success: true, survivorId, mergedId })
}
