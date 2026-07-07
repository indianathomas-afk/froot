import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin, requireModule } from "@/lib/auth"

const RowSchema = z.object({
  brand: z.string().optional().nullable(),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  glCode: z.string().optional().nullable(),
  glCodeOverride: z.string().optional().nullable(),
  productNote: z.string().optional().nullable(),
  purchaseUnitLabel: z.string().min(1),
  packDescription: z.string().optional().nullable(),
  purchaseCost: z.number().nonnegative(),
  reportingUnit: z.string().min(1),
  unitsPerPurchase: z.number().positive(),
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
    dbUser = await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  if (!Array.isArray(body)) return NextResponse.json({ error: "Expected an array of rows" }, { status: 400 })

  const categoryCache = new Map<string, string>()
  let created = 0
  const errors: { row: number; error: string }[] = []

  for (let i = 0; i < body.length; i++) {
    const parsed = RowSchema.safeParse(body[i])
    if (!parsed.success) {
      errors.push({ row: i + 1, error: parsed.error.issues.map((e) => e.message).join(", ") })
      continue
    }
    const data = parsed.data

    try {
      let categoryId: string | null = null
      if (data.category) {
        const key = data.category.trim().toLowerCase()
        if (categoryCache.has(key)) {
          categoryId = categoryCache.get(key)!
        } else {
          const category = await prisma.ingredientCategory.upsert({
            where: { organizationId_name: { organizationId: org.id, name: data.category } },
            create: { organizationId: org.id, name: data.category, glCode: data.glCode || null },
            update: {},
          })
          categoryCache.set(key, category.id)
          categoryId = category.id
        }
      }

      const costPerReportingUnit = data.purchaseCost / data.unitsPerPurchase
      await prisma.ingredient.create({
        data: {
          organizationId: org.id,
          brand: data.brand || null,
          name: data.name,
          categoryId,
          subcategory: data.subcategory || null,
          sku: data.sku || null,
          glCodeOverride: data.glCodeOverride || null,
          productNote: data.productNote || null,
          purchaseUnitLabel: data.purchaseUnitLabel,
          packDescription: data.packDescription || null,
          purchaseCost: data.purchaseCost,
          reportingUnit: data.reportingUnit,
          unitsPerPurchase: data.unitsPerPurchase,
          costPerReportingUnit,
          lastEditedByUserId: dbUser?.id ?? null,
          costLogs: { create: { costPerReportingUnit, source: "IMPORT" } },
        },
      })
      created++
    } catch {
      errors.push({ row: i + 1, error: "Failed to create ingredient" })
    }
  }

  return NextResponse.json({ created, errors })
}
