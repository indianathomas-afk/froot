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

  const ingredients = await prisma.ingredient.findMany({
    where: {
      organizationId: org.id,
      ...(category ? { categoryId: category } : {}),
      ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { brand: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { category: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(ingredients)
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

  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const data = IngredientSchema.parse(body)

  const ingredient = await prisma.ingredient.create({
    data: {
      organizationId: org.id,
      brand: data.brand || null,
      name: data.name,
      categoryId: data.categoryId || null,
      purchaseUnitLabel: data.purchaseUnitLabel,
      packDescription: data.packDescription || null,
      purchaseCost: data.purchaseCost,
      reportingUnit: data.reportingUnit,
      unitsPerPurchase: data.unitsPerPurchase,
      costPerReportingUnit: data.purchaseCost / data.unitsPerPurchase,
      isActive: data.isActive ?? true,
      notes: data.notes || null,
    },
  })

  return NextResponse.json(ingredient, { status: 201 })
}
