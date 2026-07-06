import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"
import { serializeIngredient } from "@/lib/ingredient-dto"

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
  notes: z.string().optional().nullable(),
})

const includeRelations = {
  category: true,
  vendorIngredients: { include: { vendor: true } },
} as const

export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get("q")
  const category = url.searchParams.get("category")
  const isActive = url.searchParams.get("isActive")
  // active (default): not deleted, not archived. archived: not deleted, archived.
  // all: not deleted, any archive state. deleted: deletedAt set (View Deleted screen).
  const view = url.searchParams.get("view") ?? "active"

  const ingredients = await prisma.ingredient.findMany({
    where: {
      organizationId: org.id,
      ...(view === "deleted" ? { deletedAt: { not: null } } : { deletedAt: null }),
      ...(view === "active" ? { isArchived: false } : {}),
      ...(view === "archived" ? { isArchived: true } : {}),
      ...(category ? { categoryId: category } : {}),
      ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { brand: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: includeRelations,
    orderBy: { name: "asc" },
  })

  const editorIds = [...new Set(ingredients.map((i) => i.lastEditedByUserId).filter((id): id is string => !!id))]
  const editors = editorIds.length
    ? await prisma.user.findMany({ where: { id: { in: editorIds } } })
    : []
  const editorNameById = new Map(editors.map((u) => [u.id, u.name || u.email]))

  return NextResponse.json(
    ingredients.map((i) => serializeIngredient(i, i.lastEditedByUserId ? editorNameById.get(i.lastEditedByUserId) ?? null : null))
  )
}

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
  const data = IngredientSchema.parse(body)
  const costPerReportingUnit = data.purchaseCost / data.unitsPerPurchase

  const ingredient = await prisma.ingredient.create({
    data: {
      organizationId: org.id,
      brand: data.brand || null,
      name: data.name,
      categoryId: data.categoryId || null,
      subcategory: data.subcategory || null,
      sku: data.sku || null,
      purchaseUnitLabel: data.purchaseUnitLabel,
      packDescription: data.packDescription || null,
      purchaseCost: data.purchaseCost,
      reportingUnit: data.reportingUnit,
      unitsPerPurchase: data.unitsPerPurchase,
      costPerReportingUnit,
      glCodeOverride: data.glCodeOverride || null,
      productNote: data.productNote || null,
      kind: data.kind ?? "PURCHASED",
      isActive: data.isActive ?? true,
      notes: data.notes || null,
      lastEditedByUserId: dbUser?.id ?? null,
      costLogs: { create: { costPerReportingUnit, source: "MANUAL" } },
    },
    include: includeRelations,
  })

  return NextResponse.json(serializeIngredient(ingredient, dbUser?.name || dbUser?.email || null), { status: 201 })
}
