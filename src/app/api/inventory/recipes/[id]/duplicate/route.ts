import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireManagerOrAdmin, requireModule } from "@/lib/auth"

// Copy a recipe onto another variation — build the Large once, duplicate to
// Medium/Small/Kids, tweak amounts there.
const DuplicateSchema = z.object({
  salesItemId: z.string().min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { salesItemId } = DuplicateSchema.parse(body)

  const [source, target] = await Promise.all([
    prisma.recipe.findFirst({
      where: { id, organizationId: org.id },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.salesItem.findFirst({
      where: { id: salesItemId, organizationId: org.id },
      include: { recipe: true },
    }),
  ])
  if (!source) return NextResponse.json({ error: "Recipe not found" }, { status: 404 })
  if (!target) return NextResponse.json({ error: "Sales item not found" }, { status: 404 })
  if (target.recipe) {
    return NextResponse.json({ error: `"${target.displayName}" already has a recipe` }, { status: 409 })
  }

  const recipe = await prisma.$transaction(async (tx) => {
    const created = await tx.recipe.create({
      data: {
        organizationId: org.id,
        name: target.displayName,
        salesItemId,
        yieldQty: source.yieldQty,
        yieldUnit: source.yieldUnit,
        servingSizeQty: source.servingSizeQty,
        servingSizeUnit: source.servingSizeUnit,
        isActive: true,
        lines: {
          create: source.lines.map((l) => ({
            ingredientId: l.ingredientId,
            subRecipeId: l.subRecipeId,
            amount: l.amount,
            unit: l.unit,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    })
    await tx.salesItem.update({ where: { id: salesItemId }, data: { recipeStatus: "MAPPED" } })
    return created
  })

  return NextResponse.json(recipe, { status: 201 })
}
