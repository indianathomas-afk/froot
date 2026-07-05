import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const IngredientSchema = z.object({
  brand: z.string().optional().nullable(),
  name: z.string().min(1),
  categoryId: z.string().optional().nullable(),
  purchaseUnitLabel: z.string().min(1),
  packDescription: z.string().optional().nullable(),
  purchaseCost: z.number().nonnegative(),
  reportingUnit: z.string().min(1),
  unitsPerPurchase: z.number().positive(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.ingredient.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const data = IngredientSchema.partial().parse(body)

  const purchaseCost = data.purchaseCost ?? existing.purchaseCost
  const unitsPerPurchase = data.unitsPerPurchase ?? existing.unitsPerPurchase

  const updated = await prisma.ingredient.update({
    where: { id },
    data: {
      ...(data.brand !== undefined && { brand: data.brand || null }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.categoryId !== undefined && { categoryId: data.categoryId || null }),
      ...(data.purchaseUnitLabel !== undefined && { purchaseUnitLabel: data.purchaseUnitLabel }),
      ...(data.packDescription !== undefined && { packDescription: data.packDescription || null }),
      ...(data.purchaseCost !== undefined && { purchaseCost: data.purchaseCost }),
      ...(data.reportingUnit !== undefined && { reportingUnit: data.reportingUnit }),
      ...(data.unitsPerPurchase !== undefined && { unitsPerPurchase: data.unitsPerPurchase }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
      ...((data.purchaseCost !== undefined || data.unitsPerPurchase !== undefined) && {
        costPerReportingUnit: purchaseCost / unitsPerPurchase,
      }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.ingredient.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.ingredient.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ success: true })
}
