import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

const LineSchema = z.object({
  ingredientId: z.string().min(1),
  quantityOrdered: z.number().positive(),
  unitCost: z.number().nonnegative(),
})

const UpdateSchema = z.object({
  storeId: z.string().optional(),
  vendorId: z.string().optional(),
  invoiceNumber: z.string().optional().nullable(),
  expectedAt: z.string().datetime().optional().nullable(),
  lines: z.array(LineSchema).min(1).optional(),
})

async function findScopedPO(organizationId: string, id: string, isAdmin: boolean, storeIds: string[]) {
  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id,
      organizationId,
      ...(isAdmin ? {} : { storeId: { in: storeIds } }),
    },
    include: { lines: { include: { ingredient: true } }, store: true, vendor: true },
  })
  return po
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }

  const { isAdmin, storeIds } = await getUserStoreScope()
  const { id } = await params

  const po = await findScopedPO(org.id, id, isAdmin, storeIds)
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(po)
}

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

  const { isAdmin, storeIds } = await getUserStoreScope()
  const { id } = await params

  const existing = await findScopedPO(org.id, id, isAdmin, storeIds)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft purchase orders can be edited" }, { status: 409 })
  }

  const body = await req.json()
  const data = UpdateSchema.parse(body)

  let ingredientById = new Map<string, { name: string; brand: string | null }>()
  if (data.lines) {
    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: data.lines.map((l) => l.ingredientId) }, organizationId: org.id },
    })
    ingredientById = new Map(ingredients.map((i) => [i.id, i]))
    for (const line of data.lines) {
      if (!ingredientById.has(line.ingredientId)) {
        return NextResponse.json({ error: `Ingredient ${line.ingredientId} not found` }, { status: 404 })
      }
    }
  }

  const totalAmount = data.lines
    ? data.lines.reduce((sum, l) => sum + l.quantityOrdered * l.unitCost, 0)
    : existing.totalAmount

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      ...(data.storeId !== undefined && { storeId: data.storeId }),
      ...(data.vendorId !== undefined && { vendorId: data.vendorId }),
      ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber || null }),
      ...(data.expectedAt !== undefined && { expectedAt: data.expectedAt ? new Date(data.expectedAt) : null }),
      totalAmount,
      ...(data.lines && {
        lines: {
          deleteMany: {},
          create: data.lines.map((l) => {
            const ingredient = ingredientById.get(l.ingredientId)!
            return {
              ingredientId: l.ingredientId,
              ingredientName: ingredient.brand ? `${ingredient.brand} ${ingredient.name}` : ingredient.name,
              quantityOrdered: l.quantityOrdered,
              unitCost: l.unitCost,
              lineTotal: l.quantityOrdered * l.unitCost,
            }
          }),
        },
      }),
    },
    include: { lines: { include: { ingredient: true } }, store: true, vendor: true },
  })

  return NextResponse.json(updated)
}
