import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"
import { serializeIngredient } from "@/lib/ingredient-dto"
import { recomputePreparedIngredientCosts } from "@/lib/recipe-cost"

const IngredientSchema = z.object({
  brand: z.string().optional().nullable(),
  name: z.string().min(1),
  categoryId: z.string().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  purchaseUnitLabel: z.string().min(1),
  packDescription: z.string().optional().nullable(),
  purchaseCost: z.number().nonnegative(),
  reportingUnit: z.string().min(1),
  unitsPerPurchase: z.number().positive(),
  glCodeOverride: z.string().optional().nullable(),
  productNote: z.string().optional().nullable(),
  kind: z.enum(["PURCHASED", "PREPARED"]).optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  notes: z.string().optional().nullable(),
})

const includeRelations = {
  category: true,
  vendorIngredients: { include: { vendor: true } },
} as const

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

  let dbUser
  try {
    dbUser = await requireManagerOrAdmin()
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
  const costPerReportingUnit = purchaseCost / unitsPerPurchase
  const costChanged = costPerReportingUnit !== existing.costPerReportingUnit

  const updated = await prisma.ingredient.update({
    where: { id },
    data: {
      ...(data.brand !== undefined && { brand: data.brand || null }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.categoryId !== undefined && { categoryId: data.categoryId || null }),
      ...(data.subcategory !== undefined && { subcategory: data.subcategory || null }),
      ...(data.sku !== undefined && { sku: data.sku || null }),
      ...(data.purchaseUnitLabel !== undefined && { purchaseUnitLabel: data.purchaseUnitLabel }),
      ...(data.packDescription !== undefined && { packDescription: data.packDescription || null }),
      ...(data.purchaseCost !== undefined && { purchaseCost: data.purchaseCost }),
      ...(data.reportingUnit !== undefined && { reportingUnit: data.reportingUnit }),
      ...(data.unitsPerPurchase !== undefined && { unitsPerPurchase: data.unitsPerPurchase }),
      ...(data.glCodeOverride !== undefined && { glCodeOverride: data.glCodeOverride || null }),
      ...(data.productNote !== undefined && { productNote: data.productNote || null }),
      ...(data.kind !== undefined && { kind: data.kind }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
      ...(costChanged && { costPerReportingUnit }),
      lastEditedByUserId: dbUser?.id ?? null,
      ...(costChanged && { costLogs: { create: { costPerReportingUnit, source: "MANUAL" } } }),
    },
    include: includeRelations,
  })

  if (costChanged) await recomputePreparedIngredientCosts(org.id)

  return NextResponse.json(serializeIngredient(updated, dbUser?.name || dbUser?.email || null))
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

  let dbUser
  try {
    dbUser = await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.ingredient.findFirst({ where: { id, organizationId: org.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Soft delete only — no hard deletes, ever. Restore is available from the
  // View Deleted screen.
  await prisma.ingredient.update({
    where: { id },
    data: { deletedAt: new Date(), lastEditedByUserId: dbUser?.id ?? null },
  })
  return NextResponse.json({ success: true })
}
