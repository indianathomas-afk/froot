import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  categoryId: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  glCodeOverride: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  action: z.enum(["archive", "unarchive", "delete"]).optional(),
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
  const data = BulkSchema.parse(body)

  const owned = await prisma.ingredient.findMany({
    where: { id: { in: data.ids }, organizationId: org.id },
    select: { id: true },
  })
  const ids = owned.map((i) => i.id)
  if (ids.length === 0) return NextResponse.json({ error: "No matching ingredients" }, { status: 404 })

  if (data.vendorId) {
    const vendor = await prisma.vendor.findFirst({ where: { id: data.vendorId, organizationId: org.id } })
    if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }
  if (data.categoryId) {
    const category = await prisma.ingredientCategory.findFirst({ where: { id: data.categoryId, organizationId: org.id } })
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  const updateData = {
    ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
    ...(data.subcategory !== undefined && { subcategory: data.subcategory }),
    ...(data.glCodeOverride !== undefined && { glCodeOverride: data.glCodeOverride }),
    ...(data.action === "archive" && { isArchived: true }),
    ...(data.action === "unarchive" && { isArchived: false }),
    ...(data.action === "delete" && { deletedAt: new Date() }),
    lastEditedByUserId: dbUser?.id ?? null,
  }

  const vendorId = data.vendorId
  await prisma.$transaction(async (tx) => {
    if (Object.keys(updateData).length > 1) {
      // more than just lastEditedByUserId means there's real work to do
      await tx.ingredient.updateMany({ where: { id: { in: ids } }, data: updateData })
    }
    if (vendorId) {
      for (const id of ids) {
        await tx.vendorIngredient.upsert({
          where: { vendorId_ingredientId: { vendorId, ingredientId: id } },
          create: { vendorId, ingredientId: id },
          update: {},
        })
      }
    }
  })

  return NextResponse.json({ updated: ids.length })
}
