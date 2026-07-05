import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

const CategorySchema = z.object({
  name: z.string().min(1),
  glCode: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
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
  const category = await prisma.ingredientCategory.findFirst({ where: { id, organizationId: org.id } })
  if (!category) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const data = CategorySchema.partial().parse(body)

  const updated = await prisma.ingredientCategory.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.glCode !== undefined && { glCode: data.glCode || null }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
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
  const category = await prisma.ingredientCategory.findFirst({ where: { id, organizationId: org.id } })
  if (!category) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const ingredientCount = await prisma.ingredient.count({ where: { categoryId: id } })
  if (ingredientCount > 0) {
    return NextResponse.json({ error: "Category has ingredients assigned — reassign them first" }, { status: 409 })
  }

  await prisma.ingredientCategory.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
